/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import Wallet from "../wallet";
import { useMediaReleaseViewer } from "@/hooks/useMediaReleaseViewer";
import Footer from "@/components/Footer";
import Link from "next/link";
import Image from "next/image";

// Helper function to check if file type is media
const isMediaFile = (mimeType: string): boolean => {
  return mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/');
};

const MediaReleaseViewer = () => {
  const { isConnected } = useAccount();
  const {
    releases,
    isLoading,
    error,
    fetchReleases,
    decryptMetadata,
    createMediaPreviewUrl,
    downloadDecryptedFile,
    checkReleaseStatus
  } = useMediaReleaseViewer();
  
  const [selectedRelease, setSelectedRelease] = useState<any>(null);
  const [decryptedMetadata, setDecryptedMetadata] = useState<any>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [_currentTime, setCurrentTime] = useState(Date.now()); // eslint-disable-line @typescript-eslint/no-unused-vars
  const avgBlockSeconds = 2;

  const handleReleaseSelect = useCallback(async (release: any) => {
    setSelectedRelease(release);
    setDecryptedMetadata(null);
    setMediaPreviewUrl(null);

    if (release.isRevealed && release.revealed) {
      try {
        const metadata = await decryptMetadata(release.revealed);
        // console.log(`decrypted metadata=`, metadata)
        setDecryptedMetadata(metadata);

        // Create media preview URL if it's a media file
        if (metadata && isMediaFile(metadata.type)) {
          setIsLoadingMedia(true);
          try {
            const previewUrl = await createMediaPreviewUrl(metadata);
            setMediaPreviewUrl(previewUrl);
          } catch (err) {
            console.error("Failed to create media preview:", err);
          } finally {
            setIsLoadingMedia(false);
          }
        }
      } catch (err) {
        console.error("Failed to decrypt metadata:", err);
      }
    }
  }, [decryptMetadata, createMediaPreviewUrl]);

  const handleDownload = useCallback(async () => {
    if (decryptedMetadata) {
      try {
        await downloadDecryptedFile(decryptedMetadata);
      } catch (err) {
        console.error("Download failed:", err);
      }
    }
  }, [decryptedMetadata, downloadDecryptedFile]);

  const handleCheckStatus = useCallback(async () => {
    if (!selectedRelease) return;
    try {
      setIsChecking(true);
      console.log(`selectedRelease= ${selectedRelease}`)
      await checkReleaseStatus(selectedRelease.requestId);
    } catch (err) {
      console.error("Status check failed:", err);
    } finally {
      setIsChecking(false);
    }
  }, [selectedRelease, checkReleaseStatus]);

  // Define getTimeRemaining function first
  const getTimeRemaining = (release: any) => {
    if (typeof window === 'undefined') return "Loading...";

    const localStorageKey = `release_${release.requestId}`;
    const storedRelease = JSON.parse(window.localStorage.getItem(localStorageKey) || '{}');
    
    if (storedRelease.createdAt && storedRelease.targetBlock) {
      const createdAt = storedRelease.createdAt;
      const targetBlock = Number(storedRelease.targetBlock);
      
      // Calculate estimated unlock time based on creation time and blocks ahead
      const blocksAhead = targetBlock - (storedRelease.createdAtBlock || 0);
      const estimatedUnlockTime = createdAt + (blocksAhead * avgBlockSeconds * 1000);
      const now = Date.now();
      
      if (now >= estimatedUnlockTime) {
        return "Unlocked!";
      }
      
      // Calculate time remaining based on estimated unlock time
      const timeRemainingMs = estimatedUnlockTime - now;
      const totalSeconds = Math.floor(timeRemainingMs / 1000);
      
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = Math.floor(totalSeconds % 60);
      
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    // Fallback to block-based calculation if localStorage data is not available
    if (!release.currentBlock || !release.unlockAtBlock) return "Unknown";

    const blocksRemaining = Number(release.unlockAtBlock - release.currentBlock);
    if (blocksRemaining <= 0) return "Unlocked!";

    const totalSeconds = blocksRemaining * avgBlockSeconds;
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };


  const handleRefresh = useCallback(() => {
    fetchReleases();
  }, [fetchReleases]);

  // Single consolidated effect for countdown and reveal checking
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
      
      // Auto-check for reveals when countdown reaches zero
      releases.forEach(release => {
        const timeRemaining = getTimeRemaining(release);
        if (timeRemaining === "Unlocked!" && !release.isRevealed) {
          checkReleaseStatus(release.requestId).catch(err => {
            console.warn("Auto-check reveal failed:", err);
          });
        }
      });
    }, 60000); // Check every 1min

    return () => clearInterval(interval);
  }, [releases, checkReleaseStatus]);

  // Cleanup effect for media preview URLs
  React.useEffect(() => {
    return () => {
      if (mediaPreviewUrl) {
        URL.revokeObjectURL(mediaPreviewUrl);
      }
    };
  }, [mediaPreviewUrl]);

  const getStatusBadge = (release: any) => {
    if (release.isRevealed) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          Released
        </span>
      );
    }

    if (release.isUnlocked) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          Ready to Release
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
        Locked
      </span>
    );
  };

  if (!isConnected) {
    return <Wallet />;
  }

  return (
    <>
    <div className="bg-white-pattern">
      <div className=" max-w-7xl mx-auto px-4 py-20 font-sans min-h-screen">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Media Release Viewer</h1>
          <p className="text-lg text-gray-600">
            View and manage your time-locked media releases
          </p>
        </div>

        {/* Quick Actions */}
        <div className=" w-48 bg-white border border-gray-800 rounded-lg p-6 shadow-sm m-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <Link
                  href="/media-release"
                  className="block w-full px-4 py-2 text-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Create New Release
                </Link>
              </div>
            </div>

        <div className="space-y-8">
          {/* Top Section - Release List */}
          <div>
            <div className="bg-white border border-gray-700 rounded-lg shadow-sm">
              <div className="p-6 border-b border-gray-500">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold text-gray-800">Your Releases</h2>
                  <button
                    onClick={handleRefresh}
                    disabled={isLoading}
                    className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    {isLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="p-6">
                {error && (
                  <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200">
                    <p className="text-red-800 text-sm">{error}</p>
                  </div>
                )}

                {isLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="text-gray-500 mt-2">Loading releases...</p>
                  </div>
                ) : releases.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">📁</div>
                    <p>No media releases found</p>
                    <p className="text-sm">Create your first release in the Media Release page</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {releases.map((release) => (
                      <div
                        key={release.requestId.toString()}
                        onClick={() => handleReleaseSelect(release)}
                        className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedRelease?.requestId === release.requestId
                            ? "border-blue-800 bg-blue-50"
                            : "border-gray-700 hover:border-yellow-700"
                          }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <h3 className="font-medium text-gray-900">
                              Release #{release.requestId.toString()}
                            </h3>
                            <p className="text-sm text-emerald-600">
                              Creator: {release.creator.substring(0, 4) + '....' + release.creator.slice(39, 43)}
                            </p>
                          </div>
                          {getStatusBadge(release)}
                        </div>

                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-emerald-600">Unlock Block:</span>
                            <p className="font-medium text-red-400">{release.unlockAtBlock.toString()}</p>
                          </div>
                          <div>
                            <span className="text-emerald-600">Time Remaining:</span>
                            <p className="font-medium font-mono text-lg text-yellow-500">{getTimeRemaining(release)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Section - Release Details */}
          <div className="space-y-6">
            {selectedRelease ? (
              <div className="bg-white border border-gray-700 rounded-lg p-6 shadow-sm text-blue-700">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Release Details</h2>

                <div className="space-y-6">
                  <div className="flex flex-wrap gap-8 justify-evenly">
                    <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Request ID</label>
                    <p className="text-sm font-mono bg-gray-100 p-2 rounded">{selectedRelease.requestId.toString()}</p>
                    </div>

                    <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Status</label>
                    <div className="mt-1">{getStatusBadge(selectedRelease)}</div>
                    </div>

                    <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Creator</label>
                    <p className="text-sm font-mono bg-gray-100 p-2 rounded">{selectedRelease.creator.substring(0, 4) + '....' + selectedRelease.creator.slice(39, 43)}</p>
                    </div>

                    <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Unlock Block</label>
                    <p className="text-sm">{selectedRelease.unlockAtBlock.toString()}</p>
                    </div>

                    <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Current Block</label>
                    <p className="text-sm">{selectedRelease.currentBlock?.toString() || "Unknown"}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Time Remaining</label>
                    <p className="text-lg font-medium font-mono">{getTimeRemaining(selectedRelease)}</p>
                  </div>

                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleCheckStatus}
                      disabled={isChecking}
                      className="w-full px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50"
                    >
                      {isChecking ? "Checking..." : "Check Status Now"}
                    </button>
                  </div>

                  {!selectedRelease.isRevealed && (
                    <div className="pt-4 border-t border-gray-700">
                      <div className="text-center p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                        {selectedRelease.currentBlock && selectedRelease.unlockAtBlock && Number(selectedRelease.unlockAtBlock) > Number(selectedRelease.currentBlock) ? (
                          <>
                            <p className="text-yellow-800 text-sm">Media hasn&apos;t been decrypted yet. Wait for the countdown:</p>
                            <p className="text-2xl font-mono mt-2 text-yellow-900">{getTimeRemaining(selectedRelease)}</p>
                          </>
                        ) : (
                          <p className="text-yellow-800 text-sm">This release is unlocked but not yet revealed. We&apos;ll fetch the decryption key shortly.</p>
                        )}
                      </div>
                    </div>
                  )}


                  {selectedRelease.isRevealed && decryptedMetadata && (
                    <div className="pt-4 border-t border-gray-700">
                      <h3 className="font-medium text-gray-800 mb-3">Decrypted Content</h3>
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-8 justify-evenly">
                          <label className="block text-sm font-medium text-gray-500 mb-1">Filename</label>
                          <p className="text-sm">{decryptedMetadata.filename}</p>
                          <label className="block text-sm font-medium text-gray-500 mb-1">Type</label>
                          <p className="text-sm">{decryptedMetadata.type}</p>
                          <label className="block text-sm font-medium text-gray-500 mb-1">Size</label>
                          <p className="text-sm">{(decryptedMetadata.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>

                        {/* Media Preview */}
                        {isMediaFile(decryptedMetadata.type) && (
                          <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-500 mb-2">Preview</label>
                            {isLoadingMedia ? (
                              <div className="flex items-center justify-center p-8 bg-gray-400 rounded-lg">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                <span className="ml-2 text-gray-600">Loading media...</span>
                              </div>
                            ) : mediaPreviewUrl ? (
                              <div className="bg-gray-100 rounded-lg p-2">
                                {decryptedMetadata.type.startsWith('image/') && (
                                  <Image
                                    width={300}
                                    height={450}
                                    src={mediaPreviewUrl}
                                    alt={decryptedMetadata.filename}
                                    className="max-w-full h-auto rounded-lg"
                                    style={{ maxHeight: '300px' }}
                                  />
                                )}
                                {decryptedMetadata.type.startsWith('video/') && (
                                  <video
                                    width={300}
                                    height={450}
                                    src={mediaPreviewUrl}
                                    controls
                                    className="max-w-full h-auto rounded-lg"
                                    style={{ maxHeight: '300px' }}
                                  >
                                    Your browser does not support the video tag.
                                  </video>
                                )}
                                {decryptedMetadata.type.startsWith('audio/') && (
                                  <audio
                                    src={mediaPreviewUrl}
                                    controls
                                    className="w-full"
                                  >
                                    Your browser does not support the audio tag.
                                  </audio>
                                )}
                              </div>
                            ) : (
                              <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                                <p className="text-yellow-800 text-sm">Failed to load media preview</p>
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          onClick={handleDownload}
                          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          Download File
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedRelease.isUnlocked && !selectedRelease.isRevealed && (
                    <div className="pt-4 border-t border-gray-700">
                      <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-blue-800 text-sm">
                          This release is unlocked! The decryption key is being fetched...
                        </p>
                        <p className="text-blue-600 text-xs mt-1">
                          The system will automatically detect when the reveal event occurs.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-700 rounded-lg p-6 shadow-sm">
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">📋</div>
                  <p>Select a release to view details</p>
                </div>
              </div>
            )} 
          </div>
        </div>
      </div>
      <Footer />
      </div>
    </>
  );
};

export default MediaReleaseViewer;
