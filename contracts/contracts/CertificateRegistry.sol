// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract CertificateRegistry {
    struct Certificate {
        bytes32 digest;
        address issuer;
        uint64 issuedAt;
        bool revoked;
    }

    address public immutable administrator = msg.sender;
    mapping(address => bool) public approved;
    mapping(bytes32 => Certificate) public certificates;

    error Forbidden();
    error Duplicate();
    error InvalidRecord();
    event IssuerApproval(address indexed issuer, bool enabled);
    event Registered(bytes32 indexed id, address indexed issuer, bytes32 digest);
    event Revoked(bytes32 indexed id, address indexed actor);

    function setIssuer(address issuer, bool enabled) external {
        if (msg.sender != administrator) revert Forbidden();
        if (issuer == address(0) || issuer == administrator) revert InvalidRecord();
        approved[issuer] = enabled;
        emit IssuerApproval(issuer, enabled);
    }

    function register(bytes32 id, bytes32 digest) external {
        if (!approved[msg.sender]) revert Forbidden();
        if (id == bytes32(0) || digest == bytes32(0)) revert InvalidRecord();
        if (certificates[id].issuer != address(0)) revert Duplicate();
        certificates[id] = Certificate(digest, msg.sender, uint64(block.timestamp), false);
        emit Registered(id, msg.sender, digest);
    }

    function revoke(bytes32 id) external {
        Certificate storage record = certificates[id];
        if (record.issuer == address(0) || record.revoked) revert InvalidRecord();
        if (msg.sender != administrator && (msg.sender != record.issuer || !approved[msg.sender])) {
            revert Forbidden();
        }
        record.revoked = true;
        emit Revoked(id, msg.sender);
    }
}
