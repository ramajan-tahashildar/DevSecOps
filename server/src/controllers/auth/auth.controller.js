import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { BCRYPT_ROUNDS } from "../../constants/auth.js";
import { COLLECTIONS } from "../../constants/collections.js";
import { connectDb } from "../../db/client.js";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function parseSignupBody(body) {
  const errors = [];

  if (!isNonEmptyString(body?.firstName)) errors.push("firstName is required");
  if (!isNonEmptyString(body?.lastName)) errors.push("lastName is required");
  if (!isNonEmptyString(body?.email)) errors.push("email is required");
  if (body?.age === undefined || body?.age === null || body?.age === "") {
    errors.push("age is required");
  } else {
    const age = Number(body.age);
    if (!Number.isInteger(age) || age < 13 || age > 120) {
      errors.push("age must be an integer between 13 and 120");
    }
  }
  if (!isNonEmptyString(body?.password)) {
    errors.push("password is required");
  } else if (body.password.length < 8) {
    errors.push("password must be at least 8 characters");
  }

  const email = body?.email ? normalizeEmail(body.email) : "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("email format is invalid");
  }

  let phone = undefined;
  if (body?.phone !== undefined && body?.phone !== null && String(body.phone).trim() !== "") {
    phone = String(body.phone).trim();
    if (phone.length < 8 || phone.length > 20) {
      errors.push("phone must be between 8 and 20 characters");
    }
  }

  const middleName =
    body?.middleName !== undefined && body?.middleName !== null && String(body.middleName).trim() !== ""
      ? String(body.middleName).trim()
      : "";

  if (errors.length) return { errors };

  return {
    errors: [],
    payload: {
      firstName: String(body.firstName).trim(),
      middleName,
      lastName: String(body.lastName).trim(),
      email,
      phone,
      age: Number(body.age),
      password: body.password,
    },
  };
}

function parseLoginBody(body) {
  const email = body?.email ? normalizeEmail(body.email) : "";
  const password = body?.password;

  if (!email || typeof password !== "string") {
    return { error: "email and password are required" };
  }
  return { email, password };
}

function toPublicUser(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    firstName: doc.firstName,
    middleName: doc.middleName,
    lastName: doc.lastName,
    email: doc.email,
    phone: doc.phone ?? null,
    age: doc.age,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function signAccessToken(userId, email) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign({ email }, secret, {
    subject: userId,
    expiresIn,
  });
}

export async function signup(req, res, next) {
  try {
    const parsed = parseSignupBody(req.body);
    if (parsed.errors.length) {
      return res.status(400).json({ errors: parsed.errors });
    }

    const { firstName, middleName, lastName, email, phone, age, password } = parsed.payload;

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.USERS);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = new Date();

    const doc = {
      firstName,
      middleName,
      lastName,
      email,
      ...(phone !== undefined ? { phone } : {}),
      age,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };

    const result = await col.insertOne(doc);
    const user = toPublicUser({ ...doc, _id: result.insertedId });
    const token = signAccessToken(result.insertedId.toString(), email);
    res.status(201).json({ user, token });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const parsed = parseLoginBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.USERS);
    const userDoc = await col.findOne({ email: parsed.email });

    if (!userDoc || !(await bcrypt.compare(parsed.password, userDoc.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signAccessToken(userDoc._id.toString(), userDoc.email);
    res.json({ user: toPublicUser(userDoc), token });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    if (!ObjectId.isValid(req.user.id)) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const db = await connectDb();
    const col = db.collection(COLLECTIONS.USERS);
    const userDoc = await col.findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { passwordHash: 0 } },
    );

    if (!userDoc) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: toPublicUser(userDoc) });
  } catch (err) {
    next(err);
  }
}
