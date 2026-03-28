export function errorHandler(err, _req, res, _next) {
  if (err.code === 11000) {
    const field = err.keyPattern?.email ? "email" : err.keyPattern?.phone ? "phone" : "field";
    return res.status(409).json({ error: `${field} is already registered` });
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
