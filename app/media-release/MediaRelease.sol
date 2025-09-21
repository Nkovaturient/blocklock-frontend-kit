// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {TypesLib} from "blocklock-solidity/src/libraries/TypesLib.sol";
import {AbstractBlocklockReceiver} from "blocklock-solidity/src/AbstractBlocklockReceiver.sol";

/**
 *  Upload original media to IPFS, encrypt file content using Blocklock time-based encryption.
 *  At unlock, reveals the decryption key to access the original file.
 */
contract PublicTimedMediaRelease is AbstractBlocklockReceiver {

    event Created(
        uint256 indexed requestId,
        address indexed creator,
        bytes32 fileCidHash,    // keccak256(bytes(fileCid))
        uint40  unlockAtBlock   // UI hint
    );

    // payload is the decryption key bytes. Public forever after.
    event Revealed(uint256 indexed requestId, bytes payload);

    struct Release {
        address creator;
        bytes32 fileCidHash;    // keccak256(bytes(fileCid))
        uint40  unlockAtBlock;
        bool    isRevealed;
        bytes   revealed;       // decryption key after unlock
    }

    mapping(uint256 => Release) public releases;
    mapping(uint256 => TypesLib.Ciphertext) private _decryptionKeyCipher;
    mapping(address => uint256[]) public createdBy;

    constructor(address blocklockSender) AbstractBlocklockReceiver(blocklockSender) {}

    /**
     * callbackGasLimit gas limit for the Blocklock callback
     * unlockAtBlock    UI hint only; the real enforcement is encoded in `condition`
     * fileCidHash      keccak256(bytes(fileCid)) - hash of original file CID
     * condition        bytes produced via blocklock-js encodeCondition(...)
     * decryptionKeyCipher TypesLib.Ciphertext whose plaintext = decryption key
     *
     */
    function createReleaseWithDirectFunding(
        uint32 callbackGasLimit,
        uint40 unlockAtBlock,
        bytes32 fileCidHash,
        bytes calldata condition,
        TypesLib.Ciphertext calldata decryptionKeyCipher
    ) external payable returns (uint256 requestId, uint256 requestPrice) {
        (requestId, requestPrice) =
            _requestBlocklockPayInNative(callbackGasLimit, condition, decryptionKeyCipher);

        releases[requestId] = Release({
            creator: msg.sender,
            fileCidHash: fileCidHash,
            unlockAtBlock: unlockAtBlock,
            isRevealed: false,
            revealed: bytes("")
        });

        _decryptionKeyCipher[requestId] = decryptionKeyCipher;
        createdBy[msg.sender].push(requestId);

        emit Created(requestId, msg.sender, fileCidHash, unlockAtBlock);
    }

    /*
     * decrypt the decryption key and publish it. File remains on IPFS.
     */
    function _onBlocklockReceived(uint256 _requestId, bytes calldata decryptionKey)
        internal
        override
    {
        Release storage r = releases[_requestId];
        require(r.creator != address(0), "Unknown request");
        require(!r.isRevealed, "Already revealed");

        bytes memory payload = _decrypt(_decryptionKeyCipher[_requestId], decryptionKey); // decryption key
        r.isRevealed = true;
        r.revealed = payload;

        delete _decryptionKeyCipher[_requestId];

        emit Revealed(_requestId, payload);
    }

    // Convenience view for UIs
    function metaOf(uint256 requestId)
        external
        view
        returns (address creator, bytes32 fileCidHash, uint40 unlockAtBlock, bool isRevealed)
    {
        Release storage r = releases[requestId];
        return (r.creator, r.fileCidHash, r.unlockAtBlock, r.isRevealed);
    }
}
