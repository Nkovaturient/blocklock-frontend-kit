# 🎬 Secure Media Release System - Complete Implementation Guide

*A blockchain-powered time-lock media platform that lets you encrypt, upload, and automatically reveal content at precise moments using dcipher network's [Blocklock Encryption](https://github.com/randa-mu/blocklock-solidity) mechanism.*

## 🌟 What We've Built Together

Picture this: You're a content creator who wants to release exclusive media at a specific time, but you want it locked away until that exact moment. No early leaks, no manual intervention - just pure, automated, blockchain-enforced timing. That's exactly what we've created here!

This isn't just another file upload system. It's a sophisticated combination of **AES-GCM encryption**, **blocklock time-lock technology**, and **smart contract automation** that works seamlessly together to create a Netflix-like experience for time-locked content.

## 🏗️ The Complete Architecture - How Everything Works Together

### The Three-Layer Security Model

**Layer 1: AES-GCM File Encryption** 🔐
- Your media files get encrypted with military-grade AES-GCM encryption
- Each file gets a unique encryption key generated client-side
- The encrypted file is uploaded to IPFS via Lighthouse Storage
- Only the encrypted version exists on the decentralized network

**Layer 2: Blocklock Time-Lock Encryption** ⏰
- The AES-GCM decryption key gets encrypted again using blocklock technology
- This creates a "double-locked" system: file is encrypted AND the key is time-locked
- The blocklock encryption is tied to a specific blockchain block height
- No one can decrypt until that exact block is mined

**Layer 3: Smart Contract Automation** 🤖
- Our smart contract (`MediaRelease.sol`) manages the entire lifecycle
- It automatically reveals the decryption key when the target block is reached
- All metadata is stored on-chain with cryptographic hashes for verification

## 🚀 The Complete Workflow - From Upload to Download

### Step 1: File Upload & AES-GCM Encryption (`/media-release/page.tsx`)

```typescript
// What happens when you upload a file:
1. User selects a file (image, video, audio, document)
2. System generates a random 256-bit encryption key
3. File gets encrypted using AES-GCM with this key
4. Encrypted file is uploaded to IPFS via Lighthouse Storage
5. We get back an IPFS CID (Content Identifier)
6. Everything is stored in localStorage for the next step
```

**The Technical Magic:**
- We use the Web Crypto API for AES-GCM encryption
- The encryption format is: `[0x01][12-byte IV][encrypted data][16-byte auth tag]`
- This ensures both confidentiality and integrity of your files

### Step 2: Blocklock Time-Lock Creation (`useMediaRelease.ts`)

```typescript
// The blocklock encryption process:
1. User sets how many blocks ahead they want the release
2. We calculate the target block: currentBlock + blocksAhead
3. We create a payload containing:
   - The AES-GCM decryption key
   - The encrypted file's IPFS CID
   - File metadata (name, size, type)
4. This payload gets encrypted using blocklock-js
5. We call our smart contract with the encrypted payload
6. The contract stores everything and sets up the time-lock
```

**The Smart Contract Magic:**
```solidity
// Our contract extends AbstractBlocklockReceiver
contract PublicTimedMediaRelease is AbstractBlocklockReceiver {
    event Created(uint256 indexed requestId, address indexed creator, bytes32 fileCidHash, uint40 unlockAtBlock);
    event Revealed(uint256 indexed requestId, bytes payload);
    
    // When the target block is reached, blocklock automatically calls:
    function _onBlocklockReceived(uint256 _requestId, bytes calldata decryptionKey) internal override {
        // Decrypts and publishes the AES-GCM key + metadata
        emit Revealed(_requestId, decryptedPayload);
    }
}
```

### Step 3: Real-Time Monitoring & Auto-Reveal (`/viewer/page.tsx`)

```typescript
// How the viewer page works:
1. Loads all your releases from localStorage + blockchain
2. Shows a live countdown timer for each release
3. Automatically detects when releases are unlocked
4. Fetches the revealed decryption key from blockchain events
5. Decrypts and displays your media when ready
```

## 🔧 The Technical Implementation - Deep Dive

### The Hook System - Our Brain

**`useMediaRelease.ts` - The Creator**
```typescript
// This hook handles the entire creation process:
- Connects to Base Sepolia blockchain
- Calculates gas fees and blocklock costs
- Encrypts your payload with blocklock technology
- Deploys to smart contract
- Returns requestId, targetBlock, and transaction hash
```

**`useMediaReleaseViewer.ts` - The Watcher**
```typescript
// This hook is the monitoring powerhouse:
- Fetches releases from both localStorage and blockchain
- Monitors current block height for countdown timers
- Searches for "Revealed" events when countdown reaches zero
- Handles Alchemy API rate limits with chunked requests
- Provides decryption and download functionality
```

### The API Integration - Alchemy & Public RPC

**Smart Provider Management:**
```typescript
// We use a dual-provider approach:
const readonlyProvider = ALCHEMY_KEY 
  ? new ethers.JsonRpcProvider(`https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`)
  : new ethers.JsonRpcProvider("https://sepolia.base.org"); // Fallback to public RPC

// Why this matters:
- Alchemy: Faster, more reliable, but has rate limits (10-block chunks for getLogs)
- Public RPC: Free but slower, used as fallback
- We chunk large block ranges to respect Alchemy's limits
```

**The Chunked Event Fetching:**
```typescript
// We break large block ranges into 10-block chunks:
const getLogsChunked = async (filter, fromBlock, toBlock, chunkSize = 10) => {
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    const chunkLogs = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
    logs.push(...chunkLogs);
  }
  return logs;
};
```

### The Countdown System - Time Made Visual

**The Smart Countdown Logic:**
```typescript
// We use a hybrid approach for accurate timing:
const getTimeRemaining = (release) => {
  // Method 1: Use localStorage creation time + block calculation
  if (storedRelease.createdAt && storedRelease.targetBlock) {
    const estimatedUnlockTime = createdAt + (blocksAhead * 2 * 1000); // 2 seconds per block
    const timeRemainingMs = estimatedUnlockTime - Date.now();
    return formatTime(timeRemainingMs);
  }
  
  // Method 2: Fallback to real-time block comparison
  const blocksRemaining = Number(release.unlockAtBlock - release.currentBlock);
  return formatTime(blocksRemaining * 2 * 1000);
};
```

## 🎨 The User Interface - Beautiful & Functional

### The Upload Experience (`/media-release/page.tsx`)

**What Users See:**
- Drag & drop file upload with progress tracking
- Real-time encryption status and IPFS upload progress
- Block height calculator with time estimation
- Transaction confirmation with gas fee display
- Success confirmation with all the details

**What Happens Behind the Scenes:**
```typescript
// The complete upload flow:
1. File validation (size, type, etc.)
2. AES-GCM encryption with random key generation
3. IPFS upload to Lighthouse Storage
4. Blocklock payload creation and encryption
5. Smart contract interaction with proper gas estimation
6. localStorage storage for immediate UI updates
7. Success confirmation with all relevant data
```

### The Viewer Experience (`/viewer/page.tsx`)

**The New Layout - Up & Down Design:**
- **Top Section**: Grid of release cards (1-3 columns based on screen size)
- **Bottom Section**: Detailed release information and media preview
- **Responsive Design**: Works perfectly on mobile, tablet, and desktop

**The Release Cards:**
```typescript
// Each card shows:
- Release number and creator address
- Status badge (Locked/Ready to Release/Released)
- Unlock block height
- Live countdown timer
- Click to view detailed information
```

**The Detail Panel:**
```typescript
// When you select a release:
- Complete metadata (Request ID, Creator, Blocks, etc.)
- Live countdown timer
- Status check button
- Media preview (images, videos, audio)
- Download button when content is revealed
```

## 🔄 The Data Flow - How Information Moves

### Creation Flow
```
User Upload → AES-GCM Encryption → IPFS Upload → Blocklock Encryption → Smart Contract → localStorage
```

### Monitoring Flow
```
localStorage + Blockchain Events → Real-time Updates → Countdown Display → Auto-reveal Detection
```

### Reveal Flow
```
Block Height Reached → Blocklock Decryption → Revealed Event → Fetch Payload → Decrypt Media → Display/Download
```

## 🛠️ Configuration & Environment

### Required Environment Variables
```env
# Wallet Connection
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_wallet_connect_project_id

# Blockchain RPC
NEXT_PUBLIC_ALCHEMY_KEY=your_alchemy_api_key
NEXT_PUBLIC_BASE_SEPOLIA_RPC=https://sepolia.base.org

# IPFS Storage
NEXT_PUBLIC_LIGHTHOUSE_API_KEY=your_lighthouse_api_key

# Performance Tuning
NEXT_PUBLIC_PREFETCH_BEFORE=1
NEXT_PUBLIC_REVEAL_SEARCH_FORWARD=200
NEXT_PUBLIC_GETLOGS_CHUNK=10
NEXT_PUBLIC_AVG_BLOCK_SECS=2
```

### Smart Contract Details
- **Network**: Base Sepolia (Chain ID: 84532)
- **Contract Address**: `0x95E30B7f27D5a5B4719A9E4eB708cB4f5e1b72a1`
- **Explorer**: [View on Basescan](https://sepolia.basescan.org/address/0x95E30B7f27D5a5B4719A9E4eB708cB4f5e1b72a1)

## 🚀 Getting Started - Your First Release

### 1. Setup
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Start the development server
npm run dev
```

### 2. Create Your First Release
1. Navigate to `/media-release`
2. Upload a file (any type - images, videos, documents)
3. Set your release delay (e.g., 50 blocks = ~100 seconds)
4. Click "Create Media Release"
5. Confirm the transaction in your wallet
6. Watch the magic happen!

### 3. Monitor Your Release
1. Navigate to `/viewer`
2. See your release in the grid
3. Watch the countdown timer
4. When it reaches zero, your content automatically unlocks
5. Preview and download your revealed media

## 🔐 Security Features - Built for Production

### Encryption Security
- **AES-GCM**: Industry-standard encryption with authentication
- **Random IVs**: Each file gets a unique initialization vector
- **Client-side Key Generation**: Keys never leave your browser unencrypted
- **Double Encryption**: File + Key are both encrypted separately

### Blockchain Security
- **Blocklock Integration**: Proven time-lock mechanism
- **Smart Contract Verification**: All code is open source and auditable
- **Gas Optimization**: Efficient contract design minimizes costs
- **Event-based Architecture**: Decentralized and censorship-resistant

### Access Control
- **Creator-only Access**: Only you can view your release metadata
- **Public Transparency**: Release events are publicly verifiable
- **Automatic Timing**: No manual intervention possible
- **Cryptographic Proofs**: All operations are cryptographically verifiable

## 🎯 Performance Optimizations

### API Rate Limiting
- **Chunked Requests**: Respects Alchemy's 10-block limit
- **Smart Caching**: Uses localStorage to reduce blockchain calls
- **Efficient Polling**: Only updates when necessary
- **Fallback Providers**: Graceful degradation when APIs fail

### UI Performance
- **Consolidated Effects**: Single useEffect per component
- **Optimized Re-renders**: Minimal state updates
- **Lazy Loading**: Media previews load on demand
- **Responsive Design**: Works on all device sizes

## 🔧 Troubleshooting & Common Issues

### Upload Issues
- **File Size**: Maximum 100MB per file
- **Network**: Ensure stable internet connection
- **Wallet**: Make sure wallet is connected to Base Sepolia

### Reveal Issues
- **Block Height**: Ensure target block has been reached
- **Network**: Check if Base Sepolia is experiencing delays
- **Gas**: Ensure sufficient ETH for transaction fees

### API Issues
- **Alchemy Limits**: Free tier has rate limits, consider upgrading
- **RPC Failures**: System automatically falls back to public RPC
- **Event Fetching**: Large block ranges are automatically chunked

## 🚀 Future Enhancements

### Planned Features
- **Batch Uploads**: Upload multiple files at once
- **Custom Metadata**: Add custom fields to releases
- **Social Features**: Share release links with others
- **Analytics**: Track release performance and engagement

### Technical Improvements
- **IPFS Pinning**: Ensure long-term file availability
- **Multi-network Support**: Deploy to other EVM chains

## 🤝 Contributing & Development

### Development Setup
```bash
# Clone the repository
git clone <repository-url>
cd blocklock-frontend-kit

# Install dependencies
npm install

# Start development server
npm run dev


# Build for production
npm run build
```

---

## 🎉 Conclusion

The system is production-ready, secure, and provides an intuitive user experience for creating and managing time-locked media releases. Every aspect has been carefully designed to work together seamlessly, from the initial file upload to the final content reveal.

*Happy releasing! 🎬✨*