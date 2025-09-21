import { useCallback, useState, useEffect } from "react";
import { ethers } from "ethers";
import { useEthersProvider, useEthersSigner } from "./useEthers";
import { useAccount } from "wagmi";
import { MEDIA_RELEASE_ABI, CONTRACT_ADDRESS } from "@/app/media-release/contract";

export interface MediaReleaseInfo {
  requestId: bigint;
  creator: string;
  fileCidHash: string;
  unlockAtBlock: bigint;
  isRevealed: boolean;
  revealed?: string;
  currentBlock?: Number;
  isUnlocked?: boolean;
}

export interface MediaMetadata {
  filename: string;
  size: number;
  type: string;
  fileCid: string; // encrypted CID
  decryptionKey: string; // hex
  timestamp: string;
}

export const useMediaReleaseViewer = () => {
  const [releases, setReleases] = useState<MediaReleaseInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { address, chainId } = useAccount();
  const signer = useEthersSigner({ chainId: chainId });
  const provider = useEthersProvider({ chainId: chainId });

  const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  const DEFAULT_GETLOGS_CHUNK = Number(process.env.NEXT_PUBLIC_GETLOGS_CHUNK || (ALCHEMY_KEY ? "10" : "3000"));
  const PREFETCH_BLOCKS_BEFORE = Number(process.env.NEXT_PUBLIC_PREFETCH_BEFORE || "12");
  // when scanning forward after the target block, searching at most this many blocks forward
  const REVEAL_SEARCH_FORWARD = Number(process.env.NEXT_PUBLIC_REVEAL_SEARCH_FORWARD || "200");


  // --- Readonly provider for Base Sepolia
  const readonlyProvider: ethers.JsonRpcProvider | undefined = (() => {
    try {
      if (ALCHEMY_KEY) {
        const transport = `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`;
        return new ethers.JsonRpcProvider(transport);
      }
      // Public RPC fallback (rate-limited)
      const publicRpc = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || "https://sepolia.base.org";
      return new ethers.JsonRpcProvider(publicRpc);
    } catch (err) {
      console.warn("Failed to construct readonly provider:", err);
      return undefined;
    }
  })();


  // Helper function to chunk large block ranges for Alchemy limits
  const getLogsChunked = useCallback(async (filter: ethers.Filter, fromBlock: number, toBlock: number, chunkSize: number) => {
    const logs: any[] = [];
    const readProv: any = readonlyProvider || provider;
    if (!readProv) throw new Error("No provider available");

    for (let start = fromBlock; start <= toBlock; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, toBlock);
      try {
        const chunkLogs = await readProv.getLogs({ ...filter, fromBlock: start, toBlock: end });
        logs.push(...chunkLogs);
      } catch (err) {
        console.warn(`Failed to get logs for blocks ${start}-${end}:`, err);
      }
    }
    return logs;
  }, [readonlyProvider, provider]);

  const withRetry = async <T>(fn: () => Promise<T>, attempts = 2, delayMs = 500) => {
    let last: any;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); }
      catch (e) { last = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs)); }
    }
    throw last;
  };

  const fetchRevealedPayload = useCallback(
    async (requestId: bigint | number | string, targetBlock?: number | bigint): Promise<string | null> => {
      const readProv: any = readonlyProvider || provider;
      if (!readProv) throw new Error("No provider available to fetch reveal payload");
      try {
        console.log('requestID from fetch revealed payload=', requestId)
        const iface = new ethers.Interface(MEDIA_RELEASE_ABI as any);
        const eventSignature = "Revealed(uint256,bytes)";
        const topic0 = ethers.id(eventSignature);
        const topic1 = ethers.zeroPadValue(ethers.toBeHex(requestId), 32);

        const filter: ethers.Filter = {
          address: CONTRACT_ADDRESS,
          topics: [topic0, topic1],
        };

        const currentBlock = await readProv.getBlockNumber();

        // If targetBlock exists and it's still far in the future, skip scanning and return null.
        if (typeof targetBlock !== "undefined") {
          const tb = Number(targetBlock);
          if (currentBlock < tb - PREFETCH_BLOCKS_BEFORE) {
            // not yet time to attempt searching
            return null;
          }
        }

        // Determine a conservative search window centered on targetBlock if available,
        // otherwise fall back to a small recent window (avoid scanning huge history).
        let fromBlock = Math.max(0, currentBlock - 500); // safe fallback (small, recent window)
        let toBlock = currentBlock;

        if (typeof targetBlock !== "undefined") {
          const tb = Number(targetBlock);
          // Start searching a few blocks before the target block
          fromBlock = Math.max(0, tb - PREFETCH_BLOCKS_BEFORE);
          // Search forward from the target block to catch any reveals that happen after
          toBlock = Math.min(currentBlock, tb + REVEAL_SEARCH_FORWARD);
        }

        console.log(`fromBlock=`, fromBlock)
        console.log(`toBlock=`, toBlock)

        // If the window is negative/empty, bail out
        if (fromBlock > toBlock) return null;

        // Use chunked fetch (DEFAULT_GETLOGS_CHUNK is small for Alchemy free tier)
        const logs = await getLogsChunked(filter, fromBlock, toBlock, DEFAULT_GETLOGS_CHUNK);

        for (const l of logs) {
          try {
            const parsed = iface.parseLog(l);
            if (parsed && parsed.name === "Revealed") {
              // parsed.args.payload per ABI; fallback indexing
              const payload = parsed.args?.payload ?? parsed.args?.[1] ?? null;
              if (payload) {
                try {
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem(`media_release_last_block_${CONTRACT_ADDRESS}`, String(l.blockNumber ?? toBlock));
                  }
                } catch { }
                return (typeof payload === "string") ? payload : ethers.hexlify(payload);
              }
            }
          } catch (err) {
            // ignore bad parses
            continue;
          }
        }

        // Not found in the small window
        return null;
      } catch (err) {
        console.error("fetchRevealedPayload failed:", err);
        throw err;
      }
    },
    [readonlyProvider, provider, getLogsChunked, DEFAULT_GETLOGS_CHUNK, PREFETCH_BLOCKS_BEFORE, REVEAL_SEARCH_FORWARD]
  );


  const fetchReleases = useCallback(async () => {
    const readProv: any = readonlyProvider || provider;
    if (!signer || !readProv) return;

    setIsLoading(true);
    setError(null);

    try {
      const currentBlock: number = await withRetry(() => readProv.getBlockNumber());

      if (address) {
        const contract = new ethers.Contract(CONTRACT_ADDRESS, MEDIA_RELEASE_ABI, readProv);
        const iface = new ethers.Interface(MEDIA_RELEASE_ABI as any);
        const createdTopic = ethers.id("Created(uint256,address,bytes32,uint40)");
        const targetBlock = Number(localStorage.getItem("tblock"));
        const fromBlock = Math.max(0, targetBlock - 10);
        const toBlock = targetBlock;

        const baseFilter = {
          address: CONTRACT_ADDRESS,
          topics: [createdTopic, ethers.zeroPadValue(address, 32)],
        } as any;

        try {
          const logs = await getLogsChunked(baseFilter, fromBlock, toBlock, 10);

          const releasePromises = logs.map(async (log: any) => {
            const parsed = iface.parseLog(log);
            if (!parsed) return null as any;
            const requestId = parsed.args.requestId as bigint;
            const unlockAtBlock = parsed.args.unlockAtBlock as bigint;
            const fileCidHash = parsed.args.fileCidHash as string;

            // Only check for last 10 blocks
            let isRevealed = false;
            let revealed: string | undefined = undefined;
            
            if (currentBlock - Number(log.blockNumber) <= 10) {
              try {
                const contract = new ethers.Contract(CONTRACT_ADDRESS, MEDIA_RELEASE_ABI, readProv);
                const meta = await withRetry(() => contract.metaOf(requestId));
                isRevealed = meta.isRevealed;
                
                if (isRevealed) {
                  const revealedData = await fetchRevealedPayload(requestId);
                  revealed = revealedData || undefined;
                }
              } catch (err) {
                console.warn(`Failed to check reveal status for ${requestId}:`, err);
              }
            }

            return {
              requestId,
              creator: address,
              fileCidHash,
              unlockAtBlock,
              isRevealed,
              revealed,
              currentBlock: currentBlock,
              isUnlocked: currentBlock >= unlockAtBlock
            } as MediaReleaseInfo;
          });

          const releasesDataRaw = await Promise.all(releasePromises);
          const newItems = (releasesDataRaw.filter(Boolean) as MediaReleaseInfo[]);
          
          // Merge with existing, dedupe by requestId
          setReleases(prev => {
            const byId = new Map(prev.map(r => [r.requestId.toString(), r]));
            for (const item of newItems) {
              byId.set(item.requestId.toString(), { ...(byId.get(item.requestId.toString()) || {} as any), ...item });
            }
            return Array.from(byId.values()).sort((a, b) => Number(b.requestId - a.requestId));
          });
        } catch (err) {
          console.warn("Failed to fetch recent releases:", err);
        }
      }
    } catch (err) {
      console.error("Failed to fetch releases:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch releases");
    } finally {
      setIsLoading(false);
    }
  }, [signer, provider, readonlyProvider, address, fetchRevealedPayload, withRetry]);

  const getReleaseById = useCallback(async (requestId: bigint): Promise<MediaReleaseInfo | null> => {
    if (!signer || !provider) return null;

    try {
      const contract = new ethers.Contract(CONTRACT_ADDRESS, MEDIA_RELEASE_ABI, signer);
      const releaseInfo = await contract.metaOf(requestId);
      const currentBlock = await provider.getBlockNumber();

      // If revealed, fetch the revealed payload
      let revealed: string | undefined = undefined;
      if (releaseInfo.isRevealed) {
        try {
          const revealedData = await fetchRevealedPayload(requestId);
          revealed = revealedData || undefined;
        } catch (err) {
          console.warn(`Failed to fetch revealed payload for ${requestId}:`, err);
        }
      }

      return {
        requestId,
        creator: releaseInfo.creator,
        fileCidHash: releaseInfo.fileCidHash,
        unlockAtBlock: releaseInfo.unlockAtBlock,
        isRevealed: releaseInfo.isRevealed,
        revealed,
        currentBlock: currentBlock,
        isUnlocked: BigInt(currentBlock) >= releaseInfo.unlockAtBlock
      };
    } catch (err) {
      console.error("Failed to get release:", err);
      return null;
    }
  }, [signer, provider, fetchRevealedPayload]);

  const decryptMetadata = useCallback(async (revealedData: string, release?: MediaReleaseInfo): Promise<MediaMetadata | null> => {
    try {
      //flow: revealedData is UTF-8 JSON: { k: hexKey, c: encCid, n?, t?, s? }
      const json = ethers.toUtf8String(revealedData);
      let payload: any;
      try { payload = JSON.parse(json); } catch { payload = null; }

      if (payload && payload.k && payload.c) {
        // Verify hash matches on-chain fileCidHash
        if (release && release.fileCidHash) {
          const hash = ethers.keccak256(ethers.toUtf8Bytes(payload.c));
          if (hash.toLowerCase() !== release.fileCidHash.toLowerCase()) {
            throw new Error("Encrypted CID hash mismatch");
          }
        }

        return {
          filename: payload.n || "encrypted-file",
          size: payload.s || 0,
          type: payload.t || "application/octet-stream",
          fileCid: payload.c,
          decryptionKey: payload.k,
          timestamp: new Date().toISOString()
        };
      }

      // Fallback: payload is just a key; require caller to provide CID elsewhere
      const decryptionKey = json;
      return {
        filename: "encrypted-file",
        size: 0,
        type: "application/octet-stream",
        fileCid: "",
        decryptionKey,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.error("Failed to parse revealed payload:", err);
      return null;
    }
  }, []);

  const createMediaPreviewUrl = useCallback(async (metadata: MediaMetadata): Promise<string | null> => {
    try {
      if (!metadata.fileCid) throw new Error("Missing encrypted CID");

      // Fetch ciphertext file
      const fileUrl = `https://gateway.lighthouse.storage/ipfs/${metadata.fileCid}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      const ciphertext = new Uint8Array(await response.arrayBuffer());
      // console.log(`ciphertext=`, ciphertext)

      // Decrypt AES-GCM ciphertext with layout [0x01][12-byte IV][cipher]
      if (ciphertext.length < 1 + 12 + 16) throw new Error("Ciphertext too short");
      const version = ciphertext[0];
      if (version !== 1) throw new Error("Unsupported ciphertext version");
      const iv = ciphertext.slice(1, 13);
      const ct = ciphertext.slice(13);
      const keyBytes = new Uint8Array(metadata.decryptionKey.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)));
      const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);

      const blob = new Blob([plaintextBuf], { type: metadata.type || 'application/octet-stream' });
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error("Failed to create media preview URL:", err);
      return null;
    }
  }, []);

  const downloadDecryptedFile = useCallback(async (metadata: MediaMetadata): Promise<void> => {
    try {
      if (!metadata.fileCid) throw new Error("Missing encrypted CID");

      // Fetch ciphertext file
      const fileUrl = `https://gateway.lighthouse.storage/ipfs/${metadata.fileCid}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      const ciphertext = new Uint8Array(await response.arrayBuffer());

      // Decrypt AES-GCM ciphertext with layout [0x01][12-byte IV][cipher]
      if (ciphertext.length < 1 + 12 + 16) throw new Error("Ciphertext too short");
      const version = ciphertext[0];
      if (version !== 1) throw new Error("Unsupported ciphertext version");
      const iv = ciphertext.slice(1, 13);
      const ct = ciphertext.slice(13);
      const keyBytes = new Uint8Array(metadata.decryptionKey.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)));
      const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);

      const blob = new Blob([plaintextBuf], { type: metadata.type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = metadata.filename || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download/decrypt file:", err);
      throw err;
    }
  }, []);

  const checkReleaseStatus = useCallback(async (requestId: bigint): Promise<boolean> => {
    try {
      console.log('requestID from release status=', requestId)
      const release = await getReleaseById(requestId);
      if (!release) return false;

      // Update the release in the list
      setReleases(prev =>
        prev.map(r =>
          r.requestId === requestId ? { ...r, ...release } : r
        )
      );

      return release.isRevealed;
    } catch (err) {
      console.error("Failed to check release status:", err);
      return false;
    }
  }, [getReleaseById]);


  useEffect(() => {
    if (!address) return;
    
    let cancelled = false;
    const activeProv: any = readonlyProvider || provider;
    
    const loadFromLocalStorage = () => {
      if (typeof window === 'undefined') return;
      
      try {
        const localReleases: MediaReleaseInfo[] = [];
        
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (!key || !key.startsWith('release_')) continue;
          
          try {
            const raw = window.localStorage.getItem(key);
            if (!raw) continue;
            
            const parsed = JSON.parse(raw);
            const rid = BigInt(parsed.requestId);
            const unlockAtBlock = BigInt(parsed.targetBlock);
            
            const info: MediaReleaseInfo = {
              requestId: rid,
              creator: address,
              fileCidHash: "0x",
              unlockAtBlock,
              isRevealed: false,
              revealed: undefined,
              currentBlock: undefined,
              isUnlocked: false,
            };
            
            localReleases.push(info);
          } catch {
            // ignore malformed items
          }
        }
        
        if (localReleases.length > 0) {
          setReleases(prev => {
            const existingIds = new Set(prev.map(r => r.requestId.toString()));
            const newReleases = localReleases.filter(r => !existingIds.has(r.requestId.toString()));
            return [...newReleases, ...prev].sort((a, b) => Number(b.requestId - a.requestId));
          });
        }
      } catch {
        // ignoring localStorage errors
      }
    };

    // Update current block for countdown
    const updateCurrentBlock = async () => {
      if (cancelled || !activeProv) return;
      
      try {
        const currentBlock = await activeProv.getBlockNumber();
        setReleases(prev => prev.map(r => ({ ...r, currentBlock })));
      } catch (err) {
        console.warn("Block update failed:", err);
      }
    };

    // Initial setup
    loadFromLocalStorage();
    updateCurrentBlock();

    // Set up intervals
    const blockInterval = setInterval(updateCurrentBlock, 60000); // 1 minute

    return () => {
      cancelled = true;
      clearInterval(blockInterval);
    };
  }, [address]); 

  return {
    releases,
    isLoading,
    error,
    fetchReleases,
    getReleaseById,
    decryptMetadata,
    createMediaPreviewUrl,
    downloadDecryptedFile,
    checkReleaseStatus
  };
};
