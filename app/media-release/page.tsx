'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useMediaRelease } from '@/hooks/useMediaRelease';
import { useFilecoinUpload } from '@/hooks/useFilecoinUpload';
import Wallet from '../wallet';
import { useAccount } from 'wagmi';
import { useEncrypt } from '@/hooks/useEncrypt';

export default function MediaRelease() {
  const { isConnected } = useAccount();
  const [fileCid, setFileCid] = useState('');
  const [decryptionKey, setDecryptionKey] = useState('');
  const [requestId, setRequestId] = useState<bigint | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [fileMeta, setFileMeta] = useState<{ name: string; type: string; size: number } | null>(null);
  const {
    setBlocksAhead,
    blocksAhead,
    estimatedDecryptionTime,
  } = useEncrypt();

  const { createMediaRelease, status, isProcessing } = useMediaRelease();
  const { uploadFile, uploadProgress, resetUpload } = useFilecoinUpload();

  const disabled = useMemo(() => {
    return !fileCid || !decryptionKey || blocksAhead <= '0';
  }, [fileCid, decryptionKey, blocksAhead]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      resetUpload();
      const key = crypto.getRandomValues(new Uint8Array(32));
      const keyHex = Array.from(key, b => b.toString(16).padStart(2, '0')).join('');
      const result = await uploadFile(file, keyHex);
      if (result) {
        setFileCid(result.fileCid);
        setDecryptionKey(keyHex);
        setFileMeta({ name: file.name, type: file.type || 'application/octet-stream', size: file.size });
        setShowUploadForm(false);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    }
  }, [uploadFile, resetUpload]);

  const handleCreate = useCallback(async () => {
    try {
      const result = await createMediaRelease({
        fileCid,
        decryptionKey,
        blocksAhead,
        filename: fileMeta?.name,
        filetype: fileMeta?.type,
        filesize: fileMeta?.size
      });
      console.log("result", result);

      if (result) {
        setRequestId(result.requestId);
        // Store targetBlock for synchronization with viewer
        localStorage.setItem("tblock", String(result.targetBlock));
        localStorage.setItem(`release_${result.requestId}`, JSON.stringify({
          requestId: result.requestId.toString(),
          targetBlock: result.targetBlock.toString(),
          createdAt: Date.now(),
          createdAtBlock: result.createdAtBlock,
          txHash: result.txHash
        }));
      } 
    } catch (err: unknown) {
      console.error(err);
    }
  }, [fileCid, decryptionKey, blocksAhead, createMediaRelease, fileMeta]);

  if (!isConnected) {
    return <Wallet />;
  }

  return (
    <div className="bg-white-pattern">
      <div className="max-w-7xl mx-auto px-4 py-20 font-sans min-h-screen">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Secure Media Release</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Create time-locked media releases using blockchain technology.
            Your content remains encrypted until the specified block height is reached.
          </p>
        </div>

        {/* File Upload Success */}
        {fileCid && (
          <div className="mb-8">
            <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">1. Upload Media File</h2>
              <div className="space-y-4 p-3 sm:p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                  <span className="text-green-800 font-medium">File uploaded successfully!</span>
                </div>
                <div className="space-y-3">
                  <div className="break-all">
                    <p className="text-sm font-medium text-green-700 mb-1"><strong>Encrypted CID:</strong></p>
                    <p className="text-xs sm:text-sm text-green-700 font-mono bg-green-100 p-2 rounded border overflow-x-auto">{fileCid}</p>
                  </div>
                  <div className="break-all">
                    <p className="text-sm font-medium text-green-700 mb-1"><strong>Decryption Key:</strong></p>
                    <p className="text-xs sm:text-sm text-green-700 font-mono bg-green-100 p-2 rounded border overflow-x-auto">{decryptionKey}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setFileCid('');
                    setDecryptionKey('');
                    setRequestId(null);
                    setFileMeta(null);
                  }}
                  className="text-sm text-green-600 hover:text-green-800 underline"
                >
                  Upload different file
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {/* Upload & Setup */}
          <div className="space-y-6">
            {/* File Upload Section - Only show when no file uploaded */}
            {!fileCid && (
              <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">1. Upload Media File</h2>

                <div className="space-y-6">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      accept="image/*,video/*,audio/*,application/*"
                      className="hidden"
                      id="media-upload"
                    />
                    <label htmlFor="media-upload" className="cursor-pointer">
                      <div className="space-y-2">
                        <div className="text-3xl">📁</div>
                        <p className="text-gray-700 font-medium">Choose a file to upload</p>
                        <p className="text-sm text-gray-500">Max 100MB</p>
                      </div>
                    </label>
                  </div>

                  {uploadProgress.stage !== "idle" && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>{uploadProgress.message}</span>
                        {uploadProgress.progress && <span>{uploadProgress.progress}%</span>}
                      </div>
                      {uploadProgress.progress && (
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Release Configuration */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">{fileCid ? '2. Configure Release' : '1. Configure Release'}</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-2">
                    Release Delay (Blocks Ahead)
                  </label>
                  <input
                    type="text"
                    value={blocksAhead}
                    onChange={(e) => setBlocksAhead(e.target.value)}
                    className="w-full text-gray-800 rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="50"
                  />
                  {estimatedDecryptionTime && (
                    <p className="text-sm text-emerald-700 mt-2 font-funnel-display">
                      Estimated decryption: {estimatedDecryptionTime}
                    </p>
                  )}
                </div>

                <button
                  disabled={disabled || isProcessing}
                  onClick={handleCreate}
                  className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${disabled || isProcessing
                      ? 'bg-gray-300 cursor-not-allowed text-gray-500'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                >
                  {isProcessing ? 'Creating Release...' : 'Create Media Release'}
                </button>
              </div>
            </div>
          </div>

          {/*Status & Results */}
          <div className="space-y-6">
            {/* Status Display */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">{fileCid ? '3. Status & Results' : '2. Status & Results'}</h2>

              {status && (
                <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 mb-4">
                  <p className="text-blue-800 text-sm">{status}</p>
                </div>
              )}

              {requestId && (
                <div className="space-y-3 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-green-800 font-medium">Release Created!</span>
                  </div>
                  <div className="text-sm text-green-700">
                    <p><strong>Request ID:</strong> {requestId.toString()}</p>
                    <p><strong>Target Block:</strong> {blocksAhead} blocks ahead</p>
                    <p><strong>Estimated Time:</strong> ~{estimatedDecryptionTime}</p>
                    {typeof window !== 'undefined' && (() => {
                      try {
                        const raw = localStorage.getItem(`release_${requestId}`);
                        if (!raw) return null;
                        const { txHash } = JSON.parse(raw) || {};
                        if (!txHash) return null;
                        const href = `https://sepolia.basescan.org/tx/${txHash}`;
                        return (
                          <p className="mt-1">
                            <strong>Transaction:</strong> <a href={href} target="_blank" rel="noreferrer" className="underline text-blue-700">View on BaseScan</a>
                          </p>
                        );
                      } catch { return null; }
                    })()}
                  </div>
                </div>
              )}

              {!status && !requestId && (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">⏳</div>
                  <p>Complete the steps on the left to create a media release</p>
                </div>
              )}
            </div>

            {/* How It Works */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">How It Works</h2>
              <div className="space-y-3 text-sm text-gray-600">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-medium mt-0.5">1</div>
                  <p>Upload and encrypt your media file to IPFS/Filecoin</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-medium mt-0.5">2</div>
                  <p>Create a timed release using blocklock technology</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-medium mt-0.5">3</div>
                  <p>Content automatically decrypts at the specified block height</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-medium mt-0.5">4</div>
                  <p>Access your decrypted media through the revealed CID</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
