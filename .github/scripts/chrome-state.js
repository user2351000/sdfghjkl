const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAGIC = Buffer.from("CHP1");
const FOOTER = Buffer.from("END1");
const CHUNK_SIZE = 1024 * 1024;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

function getKey() {
  const encoded = process.env.CHROME_STATE_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error(
      "Set the CHROME_STATE_ENCRYPTION_KEY repository secret to a base64-encoded 32-byte key.",
    );
  }
  const normalized = encoded.trim();
  const key = Buffer.from(normalized, "base64");
  if (key.length !== 32 || key.toString("base64") !== normalized) {
    throw new Error("CHROME_STATE_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function writeAll(fd, data) {
  let offset = 0;
  while (offset < data.length) {
    offset += fs.writeSync(fd, data, offset, data.length - offset);
  }
}

function readExact(fd, size, allowEof = false) {
  const data = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = fs.readSync(fd, data, offset, size - offset, null);
    if (bytesRead === 0) {
      if (allowEof && offset === 0) return null;
      throw new Error("Encrypted Chrome profile is truncated.");
    }
    offset += bytesRead;
  }
  return data;
}

function encrypt(inputPath, outputPath, key) {
  const input = fs.openSync(inputPath, "r");
  const output = fs.openSync(outputPath, "w");
  try {
    writeAll(output, MAGIC);
    let records = 0;
    let totalBytes = 0;
    const buffer = Buffer.alloc(CHUNK_SIZE);
    while (true) {
      const bytesRead = fs.readSync(input, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;

      const nonce = crypto.randomBytes(NONCE_SIZE);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
      const additionalData = Buffer.alloc(8);
      additionalData.writeUInt32BE(records, 0);
      additionalData.writeUInt32BE(bytesRead, 4);
      cipher.setAAD(additionalData);
      const plaintext = buffer.subarray(0, bytesRead);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(ciphertext.length);
      writeAll(output, length);
      writeAll(output, nonce);
      writeAll(output, cipher.getAuthTag());
      writeAll(output, ciphertext);
      records += 1;
      totalBytes += bytesRead;
    }

    const footer = Buffer.alloc(16);
    FOOTER.copy(footer);
    footer.writeUInt32BE(records, 4);
    footer.writeBigUInt64BE(BigInt(totalBytes), 8);
    writeAll(output, footer);
    const footerNonce = crypto.randomBytes(NONCE_SIZE);
    const footerCipher = crypto.createCipheriv("aes-256-gcm", key, footerNonce);
    footerCipher.setAAD(footer);
    footerCipher.final();
    writeAll(output, footerNonce);
    writeAll(output, footerCipher.getAuthTag());
  } catch (error) {
    fs.closeSync(output);
    fs.closeSync(input);
    fs.rmSync(outputPath, { force: true });
    throw error;
  }
  fs.closeSync(output);
  fs.closeSync(input);
}

function decrypt(inputPath, outputPath, key) {
  const input = fs.openSync(inputPath, "r");
  const output = fs.openSync(outputPath, "w");
  try {
    if (!readExact(input, MAGIC.length).equals(MAGIC)) {
      throw new Error("Unrecognized Chrome profile state format.");
    }

    let records = 0;
    let totalBytes = 0;
    while (true) {
      const header = readExact(input, 4);
      if (header.equals(FOOTER)) {
        const footer = Buffer.concat([header, readExact(input, 12)]);
        if (footer.readUInt32BE(4) !== records || footer.readBigUInt64BE(8) !== BigInt(totalBytes)) {
          throw new Error("Encrypted Chrome profile is incomplete or corrupted.");
        }
        const footerNonce = readExact(input, NONCE_SIZE);
        const footerTag = readExact(input, TAG_SIZE);
        const footerDecipher = crypto.createDecipheriv("aes-256-gcm", key, footerNonce);
        footerDecipher.setAAD(footer);
        footerDecipher.setAuthTag(footerTag);
        footerDecipher.final();
        if (readExact(input, 1, true) !== null) {
          throw new Error("Unexpected data follows the encrypted Chrome profile.");
        }
        break;
      }

      const length = header.readUInt32BE(0);
      if (length === 0 || length > CHUNK_SIZE) {
        throw new Error("Encrypted Chrome profile contains an invalid chunk.");
      }
      const nonce = readExact(input, NONCE_SIZE);
      const tag = readExact(input, TAG_SIZE);
      const ciphertext = readExact(input, length);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      const additionalData = Buffer.alloc(8);
      additionalData.writeUInt32BE(records, 0);
      additionalData.writeUInt32BE(length, 4);
      decipher.setAAD(additionalData);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      writeAll(output, plaintext);
      records += 1;
      totalBytes += plaintext.length;
    }
  } catch (error) {
    fs.closeSync(output);
    fs.closeSync(input);
    fs.rmSync(outputPath, { force: true });
    throw error;
  }
  fs.closeSync(output);
  fs.closeSync(input);
}

async function findPreviousArtifact() {
  const repository = process.env.GITHUB_REPOSITORY;
  const currentRun = process.env.GITHUB_RUN_ID;
  const token = process.env.GITHUB_TOKEN;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!repository || !currentRun || !token || !outputPath) {
    throw new Error("GitHub Actions repository, run, token, or output context is unavailable.");
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts?name=chrome-profile-state&per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "chrome-profile-state",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Could not list saved Chrome profiles: GitHub API returned ${response.status}.`);
  }

  const { artifacts } = await response.json();
  const previous = artifacts
    .filter((artifact) => !artifact.expired && String(artifact.workflow_run?.id) !== currentRun)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  fs.appendFileSync(
    outputPath,
    `run-id=${previous?.workflow_run?.id ?? ""}${require("node:os").EOL}`,
  );
}

async function main() {
  const [command, inputPath, outputPath] = process.argv.slice(2);
  if (command === "find") {
    getKey();
    await findPreviousArtifact();
    return;
  }
  if ((command !== "encrypt" && command !== "decrypt") || !inputPath || !outputPath) {
    throw new Error("Usage: chrome-state.js find | chrome-state.js encrypt|decrypt <input> <output>");
  }

  const key = getKey();
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Chrome profile state input was not found: ${path.basename(inputPath)}.`);
  }
  if (command === "encrypt") encrypt(inputPath, outputPath, key);
  else decrypt(inputPath, outputPath, key);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
