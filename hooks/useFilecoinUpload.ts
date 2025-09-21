import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import lighthouse from '@lighthouse-web3/sdk';
import { useEthersProvider } from "./useEthers";
import { toBlobs } from "viem";

export interface UploadResult {
  fileCid: string;
  fileHash: string;
  fileUrl: string; // Lighthouse URL for encrypted file
  uploadedAtBlock: number; // block when file was uploaded
}

export interface UploadProgress {
  stage: "idle" | "encrypting" | "uploading" | "complete" | "error";
  message: string;
  progress?: number;
}

export const useFilecoinUpload = () => {
  const { isConnected } = useAccount();
  const provider = useEthersProvider();
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: "idle",
    message: ""
  });

  const LIGHTHOUSE_API_KEY = process.env.NEXT_PUBLIC_LIGHTHOUSE_API_KEY as string;

  const prepareFileForUpload = useCallback(async (file: File): Promise<{ fileData: Uint8Array; fileHash: string }> => {
    const fileBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(fileBuffer);
    const fileHash = await crypto.subtle.digest('SHA-256', fileBuffer);
    const hashArray = Array.from(new Uint8Array(fileHash));
    const fileHashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return { fileData, fileHash: fileHashHex };
  }, []);

  // AES-GCM encrypt: output layout [0x01][12-byte IV][ciphertext]
  const encryptBytes = useCallback(async (plaintext: Uint8Array, keyHex: string): Promise<Uint8Array> => {
    const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(h => parseInt(h, 16)));
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // a new ArrayBuffer from the Uint8Array to ensure proper type compatibility
    const plaintextBuffer = new ArrayBuffer(plaintext.length);
    new Uint8Array(plaintextBuffer).set(plaintext);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintextBuffer));
    const out = new Uint8Array(1 + iv.length + ct.length);
    out.set([1], 0);
    out.set(iv, 1);
    out.set(ct, 1 + iv.length);
    return out;
  }, []);

  const uploadToLighthouse = useCallback(async (data: Uint8Array, filename: string): Promise<string> => {
    setUploadProgress({
      stage: "uploading",
      message: "Uploading to Lighthouse IPFS...",
      progress: 50
    });

    try {
      const blob = new Blob([data as unknown as BlobPart], { type: 'application/octet-stream' });
      const file = new File([blob], filename, { type: 'application/octet-stream' });
      const files: File[] = [file];

      const uploadResponse = await lighthouse.upload(files, LIGHTHOUSE_API_KEY);
      
      if (!uploadResponse.data || !uploadResponse.data.Hash) {
        throw new Error('Upload failed: No CID returned from Lighthouse');
      }

      return uploadResponse.data.Hash;
    } catch (error) {
      console.error('Lighthouse upload error:', error);
      throw new Error(`Lighthouse upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [LIGHTHOUSE_API_KEY]);

  const uploadFile = useCallback(async (file: File, encryptionKeyHex?: string): Promise<UploadResult | null> => {
    if (!isConnected) {
      throw new Error("Wallet not connected");
    }

    try {
      setUploadProgress({
        stage: "uploading",
        message: "Preparing file for upload...",
        progress: 25
      });

      // Record current block for provenance (if provider available)
      const currentBlock = provider ? await provider.getBlockNumber() : 0;

      const { fileData, fileHash } = await prepareFileForUpload(file);
      
      setUploadProgress({
        stage: "uploading",
        message: "Uploading file to Lighthouse IPFS...",
        progress: 50
      });

      // encrypting client-side, then uploading ciphertext
      const dataToUpload = encryptionKeyHex ? await encryptBytes(fileData, encryptionKeyHex) : fileData;
      const filename = encryptionKeyHex ? `${file.name}.enc` : file.name;
      const fileCid = await uploadToLighthouse(dataToUpload, filename);

      setUploadProgress({
        stage: "complete",
        message: "Upload complete!",
        progress: 100
      });

      // URL for accessing file (ciphertext if encrypted)
      const fileUrl = `https://gateway.lighthouse.storage/ipfs/${fileCid}`;

      return {
        fileCid,
        fileHash,
        fileUrl,
        uploadedAtBlock: currentBlock
      };

    } catch (error) {
      console.error("Upload error:", error);
      setUploadProgress({
        stage: "error",
        message: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      throw error;
    }
  }, [isConnected, prepareFileForUpload, uploadToLighthouse, provider]);

  const resetUpload = useCallback(() => {
    setUploadProgress({
      stage: "idle",
      message: ""
    });
  }, []);

  return {
    uploadFile,
    uploadProgress,
    resetUpload,
    isConnected
  };
};
