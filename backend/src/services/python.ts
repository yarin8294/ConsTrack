import path from "path";
import { spawn } from "child_process";

const ROOT = path.resolve(process.cwd());

export async function runPythonVolumeDiff(t1Path: string, t2Path: string, voxelSize: number) {
  const py = process.env.PYTHON_BIN || "python3";
  const script = path.join(ROOT, "python", "volume_diff.py");

  return new Promise<{ volumeT1M3: number; volumeT2M3: number; volumeChangeM3: number }>((resolve, reject) => {
    const p = spawn(py, [script, "--t1", t1Path, "--t2", t2Path, "--voxel", String(voxelSize)], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("close", (code) => {
      if (code !== 0 && code !== 2) {
        return reject(new Error(`Python process failed: code=${code} err=${err}`));
      }
      try {
        const parsed = JSON.parse(out.trim() || "{}");
        if (parsed.error) return reject(new Error(parsed.error));
        resolve({
          volumeT1M3: Number(parsed.volumeT1M3 || 0),
          volumeT2M3: Number(parsed.volumeT2M3 || 0),
          volumeChangeM3: Number(parsed.volumeChangeM3 || 0),
        });
      } catch {
        reject(new Error(`Failed to parse python output. out=${out} err=${err}`));
      }
    });
  });
}

export async function runPythonExtractPoints(filePath: string, maxPoints: number = 350000) {
  const py = process.env.PYTHON_BIN || "python3";
  const script = path.join(ROOT, "python", "volume_diff.py");

  return new Promise<{ points: number[][]; colors?: number[][] }>((resolve, reject) => {
    const p = spawn(py, [script, "--extract", filePath, "--max_extract_points", String(maxPoints)], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("close", (code) => {
      if (code !== 0 && code !== 2) {
        return reject(new Error(`Python process failed: code=${code}, stderr=${err}, stdout=${out}`));
      }
      try {
        const parsed = JSON.parse(out.trim() || "{}");
        if (parsed.error) return reject(new Error(parsed.error));
        resolve({ points: parsed.points || [], colors: parsed.colors });
      } catch {
        reject(new Error(`Failed to parse python output. out=${out} err=${err}`));
      }
    });
    p.on("error", (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}. Make sure Python 3 is installed and the required packages (laspy, open3d, numpy) are available.`));
    });
  });
}
