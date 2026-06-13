import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolves to backend/uploads/ regardless of CWD or whether running from src/ vs dist/
const UPLOAD_DIR = path.resolve(__dirname, "../../uploads");

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

const ALLOWED_EXTENSIONS = new Set([".e57", ".las", ".ply"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const stem = path.basename(file.originalname, path.extname(file.originalname));
    const safe = sanitizeFilename(stem);
    const uniq = crypto.randomBytes(6).toString("hex");
    cb(null, `${Date.now()}-${uniq}-${safe}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5 GB — raw point cloud scans (.e57/.las) can be several GB
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type "${ext}". Accepted: .e57, .las, .ply`));
    }
  },
});
