import path from "path";
import { spawn } from "child_process";

const ROOT = path.resolve(process.cwd());

export interface StandardizeResult {
  cleanedPlyPath: string;
  originalPointCount: number;
  cleanedPointCount: number;
  elapsedS: number;
}

export async function runPythonStandardize(
  inputPath: string,
  outputPath: string,
  opts: { sorK?: number; sorStd?: number } = {}
): Promise<StandardizeResult> {
  const py = process.env.PYTHON_BIN || "python3";
  const script = path.join(ROOT, "python", "standardizer.py");

  const args = [
    script,
    "--input",   inputPath,
    "--output",  outputPath,
    "--sor_k",   String(opts.sorK  ?? 20),
    "--sor_std", String(opts.sorStd ?? 2.0),
  ];

  return new Promise<StandardizeResult>((resolve, reject) => {
    const p = spawn(py, args, { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));

    p.on("close", (code) => {
      if (code !== 0 && code !== 2) {
        return reject(new Error(`Standardizer failed: code=${code} stderr=${err}`));
      }
      try {
        const parsed = JSON.parse(out.trim() || "{}");
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed as StandardizeResult);
      } catch {
        reject(new Error(`Failed to parse standardizer output. out=${out} err=${err}`));
      }
    });

    p.on("error", (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

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

export interface PreprocessResult {
  fitness: number;
  rmseM: number;
  rmseCm: number;
  alignmentConfidence: "HIGH" | "MEDIUM" | "LOW";
  transformMatrix: number[][];
  alignedT2Path: string;
  elapsedS: number;
}

export async function runPythonPreprocess(
  t1Path: string,
  t2Path: string,
  outT2Path: string,
  opts: { voxelSize?: number; sorK?: number; sorStd?: number; icpDist?: number } = {}
): Promise<PreprocessResult> {
  const py = process.env.PYTHON_BIN || "python3";
  const script = path.join(ROOT, "python", "preprocessor.py");

  const args = [
    script,
    "--t1", t1Path,
    "--t2", t2Path,
    "--out_t2", outT2Path,
    "--voxel",    String(opts.voxelSize ?? 0.05),
    "--sor_k",    String(opts.sorK    ?? 20),
    "--sor_std",  String(opts.sorStd  ?? 2.0),
    "--icp_dist", String(opts.icpDist ?? 0.10),
  ];

  return new Promise<PreprocessResult>((resolve, reject) => {
    const p = spawn(py, args, { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));

    p.on("close", (code) => {
      if (code !== 0 && code !== 2) {
        return reject(new Error(`Preprocessor failed: code=${code} stderr=${err}`));
      }
      try {
        const parsed = JSON.parse(out.trim() || "{}");
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed as PreprocessResult);
      } catch {
        reject(new Error(`Failed to parse preprocessor output. out=${out} err=${err}`));
      }
    });

    p.on("error", (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

export interface ClusterInfo {
  clusterId: number;
  pointCount: number;
  centroidXYZ: [number, number, number];
  voxelVolumeM3: number;
  obbVolumeM3: number;
  obbExtentM: [number, number, number];
}

export interface ChangeDetectResult {
  totalNewVolumeM3: number;
  newElementCount: number;
  noisePointCount: number;
  clusters: ClusterInfo[];
  newElementsPath: string;
  elapsedS: number;
}

export async function runPythonChangeDetect(
  t1Path: string,
  t2AlignedPath: string,
  outNewPath: string,
  opts: { distThresh?: number; voxelSize?: number; eps?: number; minPts?: number } = {}
): Promise<ChangeDetectResult> {
  const py = process.env.PYTHON_BIN || "python3";
  const script = path.join(ROOT, "python", "change_detector.py");

  const args = [
    script,
    "--t1",          t1Path,
    "--t2_aligned",  t2AlignedPath,
    "--out_new",     outNewPath,
    "--dist_thresh", String(opts.distThresh ?? 0.05),
    "--voxel",       String(opts.voxelSize  ?? 0.05),
    "--eps",         String(opts.eps        ?? 0.15),
    "--min_pts",     String(opts.minPts     ?? 20),
  ];

  return new Promise<ChangeDetectResult>((resolve, reject) => {
    const p = spawn(py, args, { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));

    p.on("close", (code) => {
      if (code !== 0 && code !== 2) {
        return reject(new Error(`Change detector failed: code=${code} stderr=${err}`));
      }
      try {
        const parsed = JSON.parse(out.trim() || "{}");
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed as ChangeDetectResult);
      } catch {
        reject(new Error(`Failed to parse change detector output. out=${out} err=${err}`));
      }
    });

    p.on("error", (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
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
