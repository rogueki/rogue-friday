import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const MAX_PAGE_BYTES = 128_000;
const PAGE_TIMEOUT_MS = 5_000;
const denied4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied4.addSubnet(address, prefix, "ipv4");
const denied6 = new BlockList();
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["2001:db8::", 32],
  ["2001:10::", 28],
] as const)
  denied6.addSubnet(address, prefix, "ipv6");

export function isPublicResearchAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied4.check(address, "ipv4");
  if (family === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !denied6.check(address, "ipv6");
  return false;
}

function pageText(input: string): string {
  return input
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|form|template)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d{1,6});/g, (_, code: string) => {
      const value = Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : " ";
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16_000);
}

/** Pin DNS to a checked public address. The HTTP client must never resolve the name again. */
export async function fetchResearchPage(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2048)
    throw new Error("UNSAFE_URL");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), PAGE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some((entry) => !isPublicResearchAddress(entry.address)))
    throw new Error("UNSAFE_ADDRESS");
  const pinned = addresses[0]!;
  return new Promise<string>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        agent: false,
        timeout: PAGE_TIMEOUT_MS,
        maxHeaderSize: 8_192,
        headers: {
          Accept: "text/html,text/plain;q=0.9",
          "Accept-Encoding": "identity",
          "User-Agent": "FridayResearch/1.0 (https://github.com/rogueki/rogue-friday)",
        },
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          !/^(text\/html|text\/plain)(?:;|$)/i.test(String(response.headers["content-type"] ?? "")) ||
          response.headers["content-encoding"] ||
          Number(response.headers["content-length"] ?? 0) > MAX_PAGE_BYTES
        ) {
          response.destroy();
          reject(new Error("PAGE_UNAVAILABLE"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PAGE_BYTES) {
            response.destroy();
            reject(new Error("PAGE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(pageText(Buffer.concat(chunks).toString("utf8"))));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("PAGE_TIMEOUT")));
    request.on("error", reject);
    const deadline = setTimeout(() => request.destroy(new Error("PAGE_TIMEOUT")), PAGE_TIMEOUT_MS);
    request.on("close", () => clearTimeout(deadline));
    request.end();
  });
}
