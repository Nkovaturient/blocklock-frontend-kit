import { useCallback, useState } from "react";
import { ethers, Signer } from "ethers";
import { Blocklock, encodeCondition, encodeCiphertextToSolidity } from "blocklock-js";
import { useEthersProvider, useEthersSigner } from "./useEthers";
import { useAccount } from "wagmi";
import { MEDIA_RELEASE_ABI, CONTRACT_ADDRESS } from "@/app/media-release/contract";
import { BLOCKLOCK_CONTRACT_ABI } from "@/lib/contract";

export interface MediaReleaseRequest {
  fileCid: string;
  decryptionKey: string; // The key to encrypt with Blocklock
  blocksAhead: string;
  filename?: string;
  filetype?: string;
  filesize?: number;
}

export interface MediaReleaseResult {
  requestId: bigint;
  targetBlock: bigint;
  createdAtBlock: number;
  txHash: string;
}

export const useMediaRelease = () => {
  const [status, setStatus] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const provider = useEthersProvider();
  const { chainId } = useAccount();
  const signer = useEthersSigner({chainId: chainId});
  const gasConfig = {
    gasLimit: 100_000,
    maxFeePerGas: ethers.parseUnits("0.2", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("0.2", "gwei"),
    gasBufferPercent: 100,
    callbackGasLimitDefault: 1_000_000,
    gasMultiplierDefault: 10,
    blocklockAddress: "0x82Fed730CbdeC5A2D8724F2e3b316a70A565e27e",
  }

  const createMediaRelease = useCallback(async (request: MediaReleaseRequest): Promise<MediaReleaseResult | null> => {
    if (!signer || !provider || !chainId) {
      throw new Error("Please connect your wallet");
    }

    setIsProcessing(true);
    setStatus("Initializing...");

    try {
      const currentBlock = await provider.getBlockNumber();
      const targetBlock = currentBlock + Number(request.blocksAhead);
      const MAX_UINT40 = 2**40 - 1;
      if (targetBlock > MAX_UINT40) {
        throw new Error(`Target block ${targetBlock} exceeds uint40 maximum value ${MAX_UINT40}`);
      }
      
      setStatus("Initializing Blocklock...");
      const blocklock = Blocklock.createFromChainId(signer as Signer, chainId);

      // Build condition bytes and encrypt the reveal payload (JSON with key + enc CID + optional meta)
      setStatus("Encrypting reveal payload...");
      const conditionBytes = encodeCondition(BigInt(targetBlock));
      // Payload format: { k: hex key, c: encrypted CID, n?: name, t?: type, s?: size }
      const payloadObj: any = { k: request.decryptionKey, c: request.fileCid };
      if (request.filename) payloadObj.n = request.filename;
      if (request.filetype) payloadObj.t = request.filetype;
      if (typeof request.filesize === 'number') payloadObj.s = request.filesize;
      const payloadJson = JSON.stringify(payloadObj);
      const payloadBytes = ethers.toUtf8Bytes(payloadJson);
      const ciphertext = await blocklock.encrypt(payloadBytes, BigInt(targetBlock));
      const decryptionKeyCipher = encodeCiphertextToSolidity(ciphertext);

      const callbackGasLimit = 700_000;

      // Compute encrypted CID hash (bytes32)
      const encCidHash = ethers.keccak256(ethers.toUtf8Bytes(request.fileCid));
      // Creating the contract instance
      setStatus("Creating media release...");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, MEDIA_RELEASE_ABI, signer);
      const feeData = await provider.getFeeData();

      if (!feeData.maxFeePerGas) {
        throw new Error("No fee data found");
      }

      const blocklockContract = new ethers.Contract(
        gasConfig.blocklockAddress,
        BLOCKLOCK_CONTRACT_ABI,
        signer
      );

      setStatus("Calculating request price...");
      const requestPrice = (await blocklockContract.estimateRequestPriceNative(
        callbackGasLimit,
        feeData.maxFeePerGas
      )); 

      const requestCallBackPrice =
        requestPrice +
        (requestPrice * BigInt(gasConfig.gasBufferPercent)) / BigInt(100);

      console.log(
        "Request CallBack price:",
        ethers.formatEther(requestCallBackPrice),
        "ETH"
      );

      let tx;
      try {
        tx = await contract.createReleaseWithDirectFunding(
          callbackGasLimit,
          targetBlock,
          encCidHash,
          conditionBytes,
          decryptionKeyCipher,
          { value: requestCallBackPrice }
        );
      } catch (error) {
        console.error("Contract call failed:", error);
        console.error("Function parameters:", {
          callbackGasLimit,
          targetBlock,
          encCidHash,
          conditionBytesLength: conditionBytes.length,
          decryptionKeyCipher,
          value: requestCallBackPrice.toString()
        });
        throw error;
      }
      
      setStatus("Waiting for transaction confirmation...");
      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error("Transaction failed to confirm");
      }

      // Extract request ID from logs
      const createdLog = receipt.logs?.find((log: any) => {
        try {
          const iface = new ethers.Interface(MEDIA_RELEASE_ABI as any);
          const parsed = iface.parseLog(log);
          return parsed?.name === "Created";
        } catch {
          return false;
        }
      });

      if (!createdLog) {
        throw new Error("Could not find Created event in transaction logs");
      }

      const iface = new ethers.Interface(MEDIA_RELEASE_ABI as any);
      const parsed = iface.parseLog(createdLog);
      const requestId = parsed?.args?.requestId as bigint;

      setStatus("Media release created successfully!");
      
      return {
        requestId,
        targetBlock: BigInt(targetBlock),
        createdAtBlock: currentBlock,
        txHash: tx.hash
      };

    } catch (error) {
      console.error("Media release creation failed:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      setStatus(`Error: ${errorMessage}`);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [signer, provider, chainId]);

  const getReleaseInfo = useCallback(async (requestId: bigint) => {
    if (!signer || !provider) {
      throw new Error("Please connect your wallet");
    }

    try {
      const contract = new ethers.Contract(CONTRACT_ADDRESS, MEDIA_RELEASE_ABI, signer);
      const releaseInfo = await contract.metaOf(requestId);
      
      return {
        creator: releaseInfo.creator,
        fileCidHash: releaseInfo.fileCidHash,
        unlockAtBlock: releaseInfo.unlockAtBlock,
        isRevealed: releaseInfo.isRevealed
      };
    } catch (error) {
      console.error("Failed to get release info:", error);
      throw error;
    }
  }, [signer, provider]);

  const resetStatus = useCallback(() => {
    setStatus("");
  }, []);

  return {
    createMediaRelease,
    getReleaseInfo,
    status,
    isProcessing,
    resetStatus
  };
};
