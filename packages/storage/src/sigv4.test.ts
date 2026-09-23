import { describe, expect, it } from "vitest";
import { MAX_PRESIGN_SECONDS, presignUrl, signRequest, uriEncode } from "./sigv4";

/**
 * The credentials AWS uses throughout its own SigV4 documentation. They are
 * published examples, not secrets — they exist so an implementation can be
 * checked against the signatures AWS printed alongside them.
 */
const credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

const AWS_EXAMPLE_DATE = new Date("2013-05-24T00:00:00Z");

describe("signRequest — against AWS's published S3 vectors", () => {
  // AWS "Signature Calculations for the Authorization Header — Example: PUT
  // Object". If this signature stops matching, the signer is wrong, whatever
  // the rest of the suite says.
  it("reproduces the documented PUT Object signature", () => {
    const { headers } = signRequest(credentials, {
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/test$file.text",
      headers: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      body: Buffer.from("Welcome to Amazon S3.", "utf8"),
      now: AWS_EXAMPLE_DATE,
    });

    expect(headers["x-amz-content-sha256"]).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
    );
    expect(headers["Authorization"]).toContain(
      "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class",
    );
    expect(headers["Authorization"]).toContain(
      "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("signs the host header, so a signature cannot be replayed elsewhere", () => {
    const { headers } = signRequest(credentials, {
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/a.txt",
      headers: {},
      now: AWS_EXAMPLE_DATE,
    });
    expect(headers["Authorization"]).toContain("host");
    expect(headers["host"]).toBe("examplebucket.s3.amazonaws.com");
  });

  it("folds a session token into the signed headers when one is present", () => {
    const { headers } = signRequest(
      { ...credentials, sessionToken: "token-abc" },
      {
        method: "PUT",
        url: "https://examplebucket.s3.amazonaws.com/a.txt",
        headers: {},
        now: AWS_EXAMPLE_DATE,
      },
    );
    expect(headers["x-amz-security-token"]).toBe("token-abc");
    expect(headers["Authorization"]).toContain("x-amz-security-token");
  });

  it("hashes an absent body as the empty-string digest", () => {
    const { headers } = signRequest(credentials, {
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/a.txt",
      headers: {},
      now: AWS_EXAMPLE_DATE,
    });
    expect(headers["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("presignUrl — against AWS's published S3 vector", () => {
  // AWS "Signature Calculations for the Query Parameters — Example: GET Object".
  it("reproduces the documented presigned GET signature", () => {
    const url = presignUrl(credentials, {
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      expiresInSeconds: 86400,
      now: AWS_EXAMPLE_DATE,
    });

    expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("carries the credential scope and expiry in the query string", () => {
    const params = new URL(
      presignUrl(credentials, {
        method: "GET",
        url: "https://examplebucket.s3.amazonaws.com/test.txt",
        expiresInSeconds: 300,
        now: AWS_EXAMPLE_DATE,
      }),
    ).searchParams;

    expect(params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(params.get("X-Amz-Credential")).toBe(
      "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
    );
    expect(params.get("X-Amz-Expires")).toBe("300");
    expect(params.get("X-Amz-SignedHeaders")).toBe("host");
  });

  // A URL that never expires is a permanent, unauthenticated handle on a
  // private object, so the ceiling is enforced rather than clamped silently.
  it.each([0, -1, MAX_PRESIGN_SECONDS + 1, 1.5])("rejects an expiry of %s", (seconds) => {
    expect(() =>
      presignUrl(credentials, {
        method: "GET",
        url: "https://examplebucket.s3.amazonaws.com/test.txt",
        expiresInSeconds: seconds,
        now: AWS_EXAMPLE_DATE,
      }),
    ).toThrow(RangeError);
  });

  // The returned URL has to be spelled the way it was signed. `URL.toString()`
  // leaves `(` and `)` literal while SigV4 escapes them, so returning it
  // directly hands out a URL whose signature only verifies if the server
  // re-canonicalizes exactly as we did.
  it("emits the path in the same encoding it signed", () => {
    const url = presignUrl(credentials, {
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/companies/a b/photo(1).webp",
      expiresInSeconds: 300,
      now: AWS_EXAMPLE_DATE,
    });
    expect(url).toContain("/companies/a%20b/photo%281%29.webp");
    expect(url).not.toContain("photo(1)");
  });
});

describe("signRequest — the URL to send", () => {
  it("emits the path in the same encoding it signed", () => {
    const { url } = signRequest(credentials, {
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/companies/a b/photo(1).webp",
      headers: {},
      now: AWS_EXAMPLE_DATE,
    });
    expect(url).toBe("https://examplebucket.s3.amazonaws.com/companies/a%20b/photo%281%29.webp");
  });

  it("leaves off the question mark when there is no query", () => {
    const { url } = signRequest(credentials, {
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/a.txt",
      headers: {},
      now: AWS_EXAMPLE_DATE,
    });
    expect(url).toBe("https://examplebucket.s3.amazonaws.com/a.txt");
  });
});

describe("presignUrl — temporary credentials", () => {
  it("signs the security token into the query for STS credentials", () => {
    const url = presignUrl(
      { ...credentials, sessionToken: "session-token-xyz" },
      {
        method: "GET",
        url: "https://examplebucket.s3.amazonaws.com/test.txt",
        expiresInSeconds: 300,
        now: AWS_EXAMPLE_DATE,
      },
    );

    const params = new URL(url).searchParams;
    expect(params.get("X-Amz-Security-Token")).toBe("session-token-xyz");
  });
});

describe("canonical path — malformed encoding", () => {
  // A lone `%` is not valid percent-encoding, so decoding it throws. Signing
  // must still produce a URL rather than failing the whole request.
  it("leaves a segment that is not valid percent-encoding untouched", () => {
    const { url } = signRequest(credentials, {
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/a%zzb.txt",
      headers: {},
      now: AWS_EXAMPLE_DATE,
    });

    expect(url).toBe("https://examplebucket.s3.amazonaws.com/a%25zzb.txt");
  });
});

describe("uriEncode", () => {
  // encodeURIComponent leaves these alone; SigV4 does not, and a mismatch
  // here silently breaks every signature for keys containing them.
  it("escapes the characters encodeURIComponent leaves alone", () => {
    expect(uriEncode("!'()*")).toBe("%21%27%28%29%2A");
  });

  it("leaves the unreserved set untouched", () => {
    expect(uriEncode("aZ09-._~")).toBe("aZ09-._~");
  });

  it("escapes a slash only when asked to", () => {
    expect(uriEncode("a/b")).toBe("a%2Fb");
    expect(uriEncode("a/b", false)).toBe("a/b");
  });

  it("encodes non-ASCII as UTF-8 bytes", () => {
    expect(uriEncode("ك")).toBe("%D9%83");
  });
});
