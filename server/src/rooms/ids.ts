import { randomBytes, randomInt } from "crypto";

// No 0/O, 1/I/L - codes get read aloud and typed on phones.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const SERIAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function pick(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export const newRoomCode = () => pick(CODE_ALPHABET, 4);
export const newCardSerial = () => pick(SERIAL_ALPHABET, 6);
export const newToken = () => randomBytes(18).toString("base64url");
export const newId = () => randomBytes(6).toString("hex");
export const cryptoRand = (maxExclusive: number) => randomInt(maxExclusive);
