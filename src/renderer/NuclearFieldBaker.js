/**
 * NuclearFieldBaker.js — Bake del campo ψ nuclear a Data3DTexture
 * =================================================================
 * Precalcula el campo ψ, gradiente ∇ψ, confinamiento y tipo de nucleón
 * en un grid 3D. El shader solo hace texture() lookups — cero loops.
 *
 * Formato del voxel (RGBA float):
 *   R = densidad (ψ² × confinement × gain)
 *   G = gradiente codificado X  (grad.x normalizado * 0.5 + 0.5)
 *   B = gradiente codificado Y  (grad.y normalizado * 0.5 + 0.5)
 *   A = gradiente magnitud + tipo nucleón
 *       bits altos: gmag (0..1 normalizado)
 *       bit bajo: isProton (codificado como gmag + isProton * 0.001)
 *       → El shader separa con floor/fract
 *
 * Alternativa más limpia — 2 texturas:
 *   Tex1 RGBA: R=density, G=gradX, B=gradY, A=gradZ  (todo en -1..1 → 0..1)
 *   Tex2 R:    isProton (0 o 1)
 * Pero para minimizar texture fetches usamos 1 sola RGBA con encoding.
 *
 * Encoding final (1 textura RGBA, UnsignedByteType para máxima compatibilidad):
 *   R = density (0..1, clamped y normalizado al max del campo)
 *   G = grad direction encoded: atan2(gy,gx) / (2π) → 0..1
 *   B = grad direction encoded: acos(gz/|g|) / π → 0..1  (esférico θ,φ)
 *   A = pack(gmag_norm, isProton): upper 7 bits = gmag, lowest bit = proton
 *     → Simplificado: A = gmag_norm * 0.5 + isProton * 0.5
 *       shader: isProton = step(0.5, A), gmag = (A - isProton*0.5) * 2.0
 *
 * Performance: 32³ = 32,768 voxels × N nucleones. Para N=120 (Oganesón):
 *   32k × 120 = 3.9M operaciones — ~50ms en JS. Una vez.
 *   vs shader: 48 steps × 1920×1080 pixels × 120 = billones. Cada frame.
 */

import * as THREE from 'three';

// ── Tuning defaults (match Preset C values) ────────────────────────────────
const DEFAULTS = {
    omega:       2.8,
    confinement: 200.0,
    densityGain: 2.5,
};

export class NuclearFieldBaker {

    /**
     * @param {number} resolution — voxels per axis (32, 48, or 64)
     */
    constructor(resolution = 32) {
        this._res = resolution;
        // Cache: symbol → { texture, maxDensity, maxGmag }
        this._cache = new Map();
    }

    /**
     * Bake el campo ψ para un elemento.
     * @param {string} symbol — e.g. 'O', 'Pb', 'Og'
     * @param {THREE.Vector3[]} protonPos
     * @param {THREE.Vector3[]} neutronPos
     * @param {number} boxSize — half-extent del box en wu
     * @param {object} [tuning] — { omega, confinement, densityGain }
     * @returns {THREE.Data3DTexture}
     */
    bake(symbol, protonPos, neutronPos, boxSize, tuning = {}) {
        // Check cache
        if (this._cache.has(symbol)) {
            return this._cache.get(symbol).texture;
        }

        const omega       = tuning.omega       ?? DEFAULTS.omega;
        const confinement = tuning.confinement ?? DEFAULTS.confinement;
        const densityGain = tuning.densityGain ?? DEFAULTS.densityGain;

        const res  = this._res;
        const res3 = res * res * res;
        const data = new Uint8Array(res3 * 4);  // RGBA

        // Nucleon positions + types
        const nucleons = [];
        for (const p of protonPos)  nucleons.push({ x: p.x, y: p.y, z: p.z, isProton: 1 });
        for (const n of neutronPos) nucleons.push({ x: n.x, y: n.y, z: n.z, isProton: 0 });
        const nCount = nucleons.length;

        // Epsilon for gradient (finite differences)
        const eps = boxSize * 2.0 / res;

        // First pass: compute raw density + gradient to find maxima for normalization
        const rawDensity = new Float32Array(res3);
        const rawGmag    = new Float32Array(res3);
        const rawGradDir = new Float32Array(res3 * 2);  // θ, φ per voxel
        const rawIsProton = new Uint8Array(res3);

        let maxDensity = 0.001;
        let maxGmag    = 0.001;

        for (let iz = 0; iz < res; iz++) {
            const z = (iz / (res - 1) - 0.5) * boxSize * 2;
            for (let iy = 0; iy < res; iy++) {
                const y = (iy / (res - 1) - 0.5) * boxSize * 2;
                for (let ix = 0; ix < res; ix++) {
                    const x = (ix / (res - 1) - 0.5) * boxSize * 2;
                    const idx = ix + iy * res + iz * res * res;

                    // ── Compute ψ ──
                    const psi = this._computePsi(x, y, z, nucleons, nCount, omega);

                    // ── Nearest nucleon (for confinement + type) ──
                    let minDist2 = 1e10;
                    let nearestProton = 0;
                    for (let n = 0; n < nCount; n++) {
                        const dx = x - nucleons[n].x;
                        const dy = y - nucleons[n].y;
                        const dz = z - nucleons[n].z;
                        const d2 = dx * dx + dy * dy + dz * dz;
                        if (d2 < minDist2) {
                            minDist2 = d2;
                            nearestProton = nucleons[n].isProton;
                        }
                    }

                    // ── Confinement ──
                    const localConf = Math.exp(-minDist2 * confinement);
                    const r = Math.sqrt(x * x + y * y + z * z);
                    const bs09 = boxSize * 0.9;
                    const bs03 = boxSize * 0.3;
                    const globalConf = r > bs09 ? 0 : r < bs03 ? 1 : (bs09 - r) / (bs09 - bs03);

                    // ── Density ──
                    const density = psi * psi * localConf * globalConf * densityGain;
                    rawDensity[idx] = density;
                    rawIsProton[idx] = nearestProton;

                    if (density > maxDensity) maxDensity = density;

                    // ── Gradient ∇ψ (finite differences) ──
                    const psiPx = this._computePsi(x + eps, y, z, nucleons, nCount, omega);
                    const psiPy = this._computePsi(x, y + eps, z, nucleons, nCount, omega);
                    const psiPz = this._computePsi(x, y, z + eps, nucleons, nCount, omega);
                    const gx = psiPx - psi;
                    const gy = psiPy - psi;
                    const gz = psiPz - psi;
                    const gmag = Math.sqrt(gx * gx + gy * gy + gz * gz);

                    if (gmag > maxGmag) maxGmag = gmag;
                    rawGmag[idx] = gmag;

                    // Encode gradient direction as spherical angles (θ, φ)
                    if (gmag > 0.0001) {
                        const ngx = gx / gmag, ngy = gy / gmag, ngz = gz / gmag;
                        // φ = atan2(gy, gx) → [-π, π] → [0, 1]
                        const phi = (Math.atan2(ngy, ngx) + Math.PI) / (2 * Math.PI);
                        // θ = acos(gz) → [0, π] → [0, 1]
                        const theta = Math.acos(Math.max(-1, Math.min(1, ngz))) / Math.PI;
                        rawGradDir[idx * 2]     = phi;
                        rawGradDir[idx * 2 + 1] = theta;
                    } else {
                        rawGradDir[idx * 2]     = 0.5;
                        rawGradDir[idx * 2 + 1] = 0.5;
                    }
                }
            }
        }

        // Second pass: normalize and pack into RGBA bytes
        for (let i = 0; i < res3; i++) {
            const ofs = i * 4;
            // R = density normalized (0..255)
            data[ofs]     = Math.min(255, (rawDensity[i] / maxDensity) * 255) | 0;
            // G = gradient φ (0..255)
            data[ofs + 1] = (rawGradDir[i * 2] * 255) | 0;
            // B = gradient θ (0..255)
            data[ofs + 2] = (rawGradDir[i * 2 + 1] * 255) | 0;
            // A = pack(gmag_norm, isProton)
            // Upper range (0..127) = gmag, bit 7 = isProton
            const gmagNorm = Math.min(1, rawGmag[i] / maxGmag);
            const gmagByte = (gmagNorm * 127) | 0;
            const protonBit = rawIsProton[i] ? 128 : 0;
            data[ofs + 3] = gmagByte | protonBit;
        }

        // Create 3D texture
        const texture = new THREE.Data3DTexture(data, res, res, res);
        texture.format = THREE.RGBAFormat;
        texture.type   = THREE.UnsignedByteType;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.wrapR = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;

        const entry = { texture, maxDensity, maxGmag };
        this._cache.set(symbol, entry);

        console.log(`[NuclearBaker] ${symbol}: ${res}³ baked — ${nCount} nucleones, maxD=${maxDensity.toFixed(3)}, maxG=${maxGmag.toFixed(3)}`);

        return texture;
    }

    /**
     * Get cached bake metadata
     */
    getMeta(symbol) {
        return this._cache.get(symbol) ?? null;
    }

    /**
     * Export baked field as .bin (for persistent cache)
     * Format: [4 bytes res][4 bytes maxDensity][4 bytes maxGmag][res³×4 bytes RGBA]
     * @returns {ArrayBuffer}
     */
    exportBin(symbol) {
        const entry = this._cache.get(symbol);
        if (!entry) return null;

        const res = this._res;
        const texData = entry.texture.image.data;
        const header = new Float32Array([res, entry.maxDensity, entry.maxGmag]);
        const buf = new ArrayBuffer(12 + texData.byteLength);
        new Float32Array(buf, 0, 3).set(header);
        new Uint8Array(buf, 12).set(texData);
        return buf;
    }

    /**
     * Import from .bin
     * @returns {THREE.Data3DTexture}
     */
    importBin(symbol, buffer) {
        const header = new Float32Array(buffer, 0, 3);
        const res = header[0] | 0;
        const maxDensity = header[1];
        const maxGmag = header[2];
        const data = new Uint8Array(buffer, 12);

        const texture = new THREE.Data3DTexture(data, res, res, res);
        texture.format = THREE.RGBAFormat;
        texture.type   = THREE.UnsignedByteType;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.wrapR = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;

        this._cache.set(symbol, { texture, maxDensity, maxGmag });
        this._res = res;
        return texture;
    }

    /**
     * Clear cache for an element
     */
    clear(symbol) {
        const entry = this._cache.get(symbol);
        if (entry) {
            entry.texture.dispose();
            this._cache.delete(symbol);
        }
    }

    clearAll() {
        for (const [sym] of this._cache) this.clear(sym);
    }

    // ── Private: compute ψ at a point (same as shader) ──────────────────

    _computePsi(x, y, z, nucleons, nCount, omega) {
        let psi = 0;
        for (let s = 0; s < nCount; s++) {
            const dx = x - nucleons[s].x;
            const dy = y - nucleons[s].y;
            const dz = z - nucleons[s].z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 0.0001) continue;
            const wave1 = Math.cos(omega * 8.0 * d) * Math.exp(-d * d * 1.5);
            const wave2 = Math.cos(omega * 16.0 * d) * Math.exp(-d * d * 0.8);
            psi += wave1 - 0.6 * wave2;
        }
        return psi;
    }
}
