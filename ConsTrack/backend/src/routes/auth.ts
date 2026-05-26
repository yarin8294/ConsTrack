import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserModel } from "../models.js";
import { sendPasswordResetEmail } from "../services/email.js";

export const router = Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, username, password } = req.body;
    if (!name || !email || !username || !password) {
      return res.status(400).json({ error: "name, email, username, and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existingEmail = await UserModel.findOne({ email }).lean();
    if (existingEmail) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const existingUsername = await UserModel.findOne({ username }).lean();
    if (existingUsername) {
      return res.status(400).json({ error: "Username already taken" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await UserModel.create({
      name,
      email,
      username,
      passwordHash,
      createdAtISO: new Date().toISOString(),
    });

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" }
    );

    res.json({ token, user: { id: String(user._id), name: user.name, email: user.email, username: user.username } });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email/username and password are required" });
    }

    const user = await UserModel.findOne({ $or: [{ email }, { username: email }] }).lean();
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" }
    );

    res.json({ token, user: { id: String(user._id), name: user.name, email: user.email, username: user.username } });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const user = await UserModel.findOne({ email }).lean();
    if (!user) {
      return res.json({ message: "If an account with that email exists, a reset link has been sent." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 3600000).toISOString();

    await UserModel.findByIdAndUpdate(user._id, { resetToken, resetTokenExpiry });

    const resetUrl = `${process.env.CORS_ORIGIN}/reset-password?token=${resetToken}`;
    await sendPasswordResetEmail(email, resetUrl);

    res.json({ message: "If an account with that email exists, a reset link has been sent." });
  } catch (e: any) {
    console.error("Error in forgot-password:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: "token and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await UserModel.findOne({ resetToken: token }).lean();
    if (!user || !user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await UserModel.findByIdAndUpdate(user._id, {
      passwordHash,
      resetToken: undefined,
      resetTokenExpiry: undefined,
    });

    res.json({ message: "Password reset successfully" });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

