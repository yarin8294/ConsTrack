import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";

const UPLOAD_DIR = path.join(path.resolve(process.cwd()), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export function sanitizeFilename(name: string): string {
  const base = path.basename(name);
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function validateLasFile(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 4) return false;
    const signature = buffer.subarray(0, 4).toString("ascii");
    return signature === "LASF";
  } catch {
    return false;
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = sanitizeFilename(file.originalname);
    const uniq = crypto.randomBytes(6).toString("hex");
    cb(null, `${Date.now()}-${uniq}-${safe}`);
  },
});

export const upload = multer({ storage });
