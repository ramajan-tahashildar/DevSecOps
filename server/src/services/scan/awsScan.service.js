import { ObjectId } from "mongodb";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { EC2Client, DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { IAMClient, ListUsersCommand } from "@aws-sdk/client-iam";
import { COLLECTIONS } from "../../constants/collections.js";
import { connectDb } from "../../db/client.js";
import { decryptCredentialMap } from "../../utils/encrypt.js";
import { cloudServicesSetForProvider } from "../../constants/cloudServices.js";

function normalizeScannerType(t) {
  return String(t ?? "")
    .trim()
    .toLowerCase();
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * @param {Array<{ severity?: string }>} findings
 */
function summarizeFindings(findings) {
  const summary = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
  if (!Array.isArray(findings)) return summary;
  for (const f of findings) {
    summary.total++;
    const sev = String(f?.severity || "").toLowerCase();
    if (sev === "critical") summary.critical++;
    else if (sev === "high") summary.high++;
    else if (sev === "medium") summary.medium++;
    else if (sev === "low") summary.low++;
  }
  return summary;
}

/**
 * @param {unknown} perms
 */
function hasOpenWorldIpv4(perms) {
  if (!Array.isArray(perms)) return false;
  for (const p of perms) {
    const ranges = p?.IpRanges;
    if (!Array.isArray(ranges)) continue;
    if (ranges.some((r) => String(r?.CidrIp || "").trim() === "0.0.0.0/0")) return true;
  }
  return false;
}

async function listAllIamUsers(iam) {
  /** @type {Array<{ UserName?: string }>} */
  const out = [];
  /** @type {string | undefined} */
  let marker;
  for (let i = 0; i < 25; i++) {
    const res = await iam.send(
      new ListUsersCommand({
        ...(marker ? { Marker: marker } : {}),
        MaxItems: 1000,
      }),
    );
    if (Array.isArray(res?.Users)) out.push(...res.Users);
    if (!res?.IsTruncated) break;
    marker = res?.Marker;
    if (!marker) break;
  }
  return out;
}

/**
 * @param {string} scannerId
 * @param {string} userId
 * @param {import("mongodb").Document | null} [preloadedScanner] from run handler (avoids a second fetch / type mismatch)
 */
export async function runAwsScan(scannerId, userId, preloadedScanner = null) {
  if (!ObjectId.isValid(scannerId)) {
    throw new Error("Invalid scanner id");
  }
  if (!ObjectId.isValid(userId)) {
    throw new Error("Invalid user id");
  }

  const db = await connectDb();
  const jobsCol = db.collection(COLLECTIONS.SCAN_JOBS);
  const scannersCol = db.collection(COLLECTIONS.SCANNERS);
  const secretsCol = db.collection(COLLECTIONS.SECRETS);
  const reportsCol = db.collection(COLLECTIONS.SCAN_REPORTS);

  const scannerOid = new ObjectId(scannerId);
  const userOid = new ObjectId(userId);

  const now = new Date();
  const jobDoc = {
    scannerId: scannerOid,
    userId: userOid,
    status: "running",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const { insertedId: jobId } = await jobsCol.insertOne(jobDoc);

  try {
    let scanner = preloadedScanner;
    if (!scanner) {
      scanner = await scannersCol.findOne({
        _id: scannerOid,
        userId: userOid,
        isActive: true,
      });
    }

    if (!scanner || normalizeScannerType(scanner.type) !== "aws") {
      throw new Error("Scanner not found or not an AWS scanner");
    }

    const cc = scanner.cloudConfig || {};
    const region = typeof cc.region === "string" ? cc.region.trim() : "";
    if (!region) {
      throw new Error("cloudConfig.region is required");
    }

    const servicesRaw = cc.services;
    const services =
      Array.isArray(servicesRaw)
        ? servicesRaw
          .filter((x) => typeof x === "string" && x.trim())
          .map((x) => x.trim())
        : [];
    if (!services.length) {
      throw new Error("cloudConfig.services must be a non-empty array");
    }

    const allowed = cloudServicesSetForProvider("aws");
    if (allowed) {
      for (const s of services) {
        if (!allowed.has(s)) throw new Error(`Invalid cloud service for aws: ${s}`);
      }
    }

    if (!scanner.secretId) {
      throw new Error("secretId is required for AWS scans");
    }

    const secret = await secretsCol.findOne({
      _id: new ObjectId(scanner.secretId),
      userId: userOid,
      isActive: true,
    });

    if (!secret || secret.type !== "aws") {
      throw new Error("Secret not found or wrong type (expected aws accessKey/secretKey)");
    }

    const creds = decryptCredentialMap(
      /** @type {Record<string, string>} */ (secret.credentials || {}),
    );
    const accessKey = creds.accessKey?.trim();
    const secretKey = creds.secretKey?.trim();
    if (!isNonEmptyString(accessKey) || !isNonEmptyString(secretKey)) {
      throw new Error("Secret must include accessKey and secretKey for AWS");
    }

    const clientCreds = {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    };

    /** @type {Array<Record<string, unknown>>} */
    const findings = [];

    if (services.includes("s3")) {
      const s3 = new S3Client({ region, credentials: clientCreds });
      const buckets = await s3.send(new ListBucketsCommand({}));
      for (const b of buckets?.Buckets || []) {
        const name = typeof b?.Name === "string" ? b.Name : "";
        if (!name) continue;
        findings.push({
          service: "s3",
          resource: name,
          severity: "info",
          issue: "Bucket exists (check public access / encryption / logging)",
        });
      }
    }

    if (services.includes("ec2")) {
      const ec2 = new EC2Client({ region, credentials: clientCreds });
      const sg = await ec2.send(new DescribeSecurityGroupsCommand({}));
      for (const group of sg?.SecurityGroups || []) {
        const gid = typeof group?.GroupId === "string" ? group.GroupId : "";
        if (!gid) continue;
        if (hasOpenWorldIpv4(group?.IpPermissions) || hasOpenWorldIpv4(group?.IpPermissionsEgress)) {
          findings.push({
            service: "ec2",
            resource: gid,
            severity: "high",
            issue: "Security group rule allows 0.0.0.0/0 (review ingress/egress exposure)",
          });
        }
      }
    }

    if (services.includes("iam")) {
      const iam = new IAMClient({ region, credentials: clientCreds });
      const users = await listAllIamUsers(iam);
      for (const u of users) {
        const name = typeof u?.UserName === "string" ? u.UserName : "";
        if (!name) continue;
        findings.push({
          service: "iam",
          resource: name,
          severity: "info",
          issue: "IAM user exists (review MFA, access keys, and attached policies)",
        });
      }
    }

    const summary = summarizeFindings(findings);

    const reportNow = new Date();
    const reportDoc = {
      scannerId: scannerOid,
      jobId,
      userId: userOid,
      type: "aws",
      target: {
        provider: "aws",
        region,
        services,
      },
      summary,
      vulnerabilities: findings,
      fullReport: { findings },
      createdAt: reportNow,
      updatedAt: reportNow,
    };

    const { insertedId: reportId } = await reportsCol.insertOne(reportDoc);

    await jobsCol.updateOne(
      { _id: jobId },
      {
        $set: {
          status: "completed",
          completedAt: reportNow,
          updatedAt: reportNow,
        },
      },
    );

    return { ...reportDoc, _id: reportId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await jobsCol.updateOne(
      { _id: jobId },
      {
        $set: {
          status: "failed",
          error: message,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
    throw error;
  }
}

