/* eslint-disable @next/next/no-img-element */
import React from 'react';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { ImageResponse } from 'next/og';
import type { GetServerSideProps } from 'next';
import type { ServerResponse } from 'node:http';

const WIDTH = 1200;
const HEIGHT = 630;

const FONT_DIR = path.join(process.cwd(), 'public/fonts/SFUIText');
const LOGO_PATH = path.join(process.cwd(), 'public/ic-logo.svg');

interface OgAssets {
  fontRegular: ArrayBuffer;
  fontSemibold: ArrayBuffer;
  logoDataUrl: string | null;
}

let assetsPromise: Promise<OgAssets> | null = null;
let cachedPng: Buffer | null = null;

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

async function loadAssets(): Promise<OgAssets> {
  const [regular, semibold, logoSvg] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, 'SFUIText-Regular.woff')),
    fs.readFile(path.join(FONT_DIR, 'SFUIText-Semibold.woff')),
    fs.readFile(LOGO_PATH).catch(() => null),
  ]);
  // Rasterize the logo SVG. Satori's SVG handling chokes on non-trivial
  // markup, so feed it a PNG instead — same workaround as stamp's /og route.
  let logoDataUrl: string | null = null;
  if (logoSvg) {
    const pngBuffer = await sharp(logoSvg)
      .resize({ width: 360, fit: 'inside' })
      .png({ palette: false })
      .toBuffer();
    logoDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  }
  return {
    fontRegular: toArrayBuffer(regular),
    fontSemibold: toArrayBuffer(semibold),
    logoDataUrl,
  };
}

function getAssets(): Promise<OgAssets> {
  if (!assetsPromise) {
    assetsPromise = loadAssets().catch((err) => {
      assetsPromise = null;
      throw err;
    });
  }
  return assetsPromise;
}

async function renderImage(): Promise<Buffer> {
  if (cachedPng) return cachedPng;
  const assets = await getAssets();

  const image = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0a8f6b',
          backgroundImage: 'linear-gradient(135deg, #066047 0%, #0a8f6b 60%, #33b58d 100%)',
          padding: '72px 80px',
          fontFamily: 'SF',
          color: '#ffffff',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {assets.logoDataUrl ? (
            <img
              src={assets.logoDataUrl}
              width={180}
              height={60}
              alt=""
              style={{ objectFit: 'contain' }}
            />
          ) : (
            <div style={{ fontSize: 36, fontWeight: 700 }}>Gridcoin Pay</div>
          )}
          <div style={{ fontSize: 22, color: '#cdebe1', fontWeight: 400 }}>
            grcpay.gridcoin.club
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 24,
          }}
        >
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
            Accept Gridcoin in any checkout.
          </div>
          <div
            style={{
              fontSize: 30,
              color: '#e0f3ec',
              fontWeight: 400,
              maxWidth: 920,
              lineHeight: 1.35,
            }}
          >
            Self-hosted payment facilitator. Mints a fresh wallet per order,
            forwards funds to you. Non-custodial, open source.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 22,
            color: '#cdebe1',
          }}
        >
          <div style={{ display: 'flex', gap: 28 }}>
            <span>· no custody</span>
            <span>· no middleman</span>
            <span>· open source</span>
          </div>
          <div style={{ fontWeight: 600 }}>Gridcoin Pay</div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'SF', data: assets.fontRegular, weight: 400, style: 'normal' },
        { name: 'SF', data: assets.fontSemibold, weight: 700, style: 'normal' },
      ],
    },
  );

  const buffer = Buffer.from(await image.arrayBuffer());
  cachedPng = buffer;
  return buffer;
}

function writeError(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.write(body);
  res.end();
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { res } = context;
  try {
    const buffer = await renderImage();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.write(buffer);
    res.end();
    return { props: {} };
  } catch (err) {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error('[og] render failed:', message);
    writeError(res, 500, `OG image render failed: ${message}`);
    return { props: {} };
  }
};

export default function OgImagePage() {
  return null;
}
