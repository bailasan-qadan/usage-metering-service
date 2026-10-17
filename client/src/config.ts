function readPort(): number {
  const parsed = Number(process.env.PORT);
  return !process.env.PORT || Number.isNaN(parsed) ? 4000 : parsed;
}

export const config = {
  meteringUrl: (process.env.METERING_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  ),
  // Optional: reuse an existing account. Without it, the demo creates one.
  apiKey:
    process.env.METERING_API_KEY === "" ? undefined : process.env.METERING_API_KEY,
  port: readPort(),
};
