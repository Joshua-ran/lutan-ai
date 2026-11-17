export function validateImage(data: string): boolean {
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      data,
    );
  if (!match) return false;
  let decoded: string;
  try { decoded = atob(match[2]); } catch { return false; }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (
    bytes.length < 12 ||
    bytes.length > 2 * 1024 * 1024 ||
    btoa(decoded).replace(/=+$/, "") !== match[2].replace(/=+$/, "")
  )
    return false;
  if (match[1] === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (match[1] === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  return (
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  );
}
