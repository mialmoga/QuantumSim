/**
 * devMode.js — Modo Dev del ShaderLab
 *
 * Gestiona el catálogo de materiales built-in:
 *  - Lista los 58 materiales con preview en vivo
 *  - Permite cargar un .json personalizado por material
 *  - Compila y genera un ZIP con los materiales seleccionados + index.json
 *
 * Usa File System Access API para guardar directamente en /src/materials/
 * o descarga un ZIP si no está disponible.
 */

import { compilePipeline } from './compiler.js';

// ── Helpers de pipeline (mismos que materialGenerator) ────────
const pipe = (...nodes) => nodes;
const n    = (key, params) => ({ key, enabled: true, params, custom: false });
const ps     = (sz,bAmp,persp)          => n('point_size',   {sz,bAmp,persp});
const pulse  = (freq,amp,pSize)         => n('sphere_pulse', {freq,amp,pSize});
const disc   = (radius,soft,ring)       => n('disc_shape',   {radius,soft,ring});
const bright = (bright,base,vari)       => n('brightness',   {bright,base,vari});
const grade  = (r,g,b,gamma)            => n('color_grade',  {r,g,b,gamma});
const glow   = (intensity,falloff,mix)  => n('glow',         {intensity,falloff,mix});
const alpha  = (curve,opacity,floor)    => n('alpha_curve',  {curve,opacity,floor});
const frsnl  = (rim,core,pow,r,g,b)     => n('fresnel_fake', {rim,core,pow,r,g,b});
const phase  = (inner,outer,pow)        => n('phase_color',  {inner,outer,pow});
const blnk   = (speed,amp,fMul)         => n('blink',        {speed,amp,fMul});

// ── Colores por familia ────────────────────────────────────────
export const FAM_COLOR = {
  gas:'#60b0ff', metal:'#a0c0e0', crystal:'#c084fc',
  liquid:'#38bdf8', lanthanide:'#f9a8d4', radioactive:'#86efac',
};
export const FAM_ICON = {
  gas:'💨', metal:'🔩', crystal:'💎',
  liquid:'💧', lanthanide:'✨', radioactive:'☢️',
};

// ── Catálogo completo ─────────────────────────────────────────
export const MATERIALS = {
  noble_helium:       { name:'Noble Helium',       desc:'Gas noble ultraligero — halo etéreo casi invisible',                family:'gas',        pipeline: pipe(ps(1.6,0,1), pulse(2,.08,0), disc(.46,.38,0), bright(.9,.2,.05), grade(.85,.95,1,1), glow(.5,8,.3), alpha(.6,.35,0)) },
  neon_glow:          { name:'Neon Glow',           desc:'Neón — emisión naranja intensa, halo ardiente',                     family:'gas',        pipeline: pipe(ps(1.8,0,1), blnk(1.2,.3,2), disc(.46,.28,0), bright(3.5,.4,.2), grade(1.8,.6,.1,.9), glow(1.5,4,.5), alpha(.7,.65,.02)) },
  argon_plasma:       { name:'Argon Plasma',        desc:'Argón — plasma violeta-lavanda, descarga eléctrica',               family:'gas',        pipeline: pipe(ps(1.7,0,1), blnk(.8,.2,1.8), disc(.46,.32,0), bright(2.8,.35,.15), grade(.7,.4,1.8,.95), glow(1.2,5,.4), alpha(.7,.55,.01)) },
  xenon_plasma:       { name:'Xenon Plasma',        desc:'Xenón — luz azul-blanca intensa, descarga brillante',              family:'gas',        pipeline: pipe(ps(2,0,1), blnk(.6,.18,1.6), disc(.46,.30,0), bright(3.2,.4,.12), grade(.8,.9,1.9,.9), glow(1.8,4.5,.45), alpha(.7,.6,.02)) },
  plasma_glow:        { name:'Plasma Glow',         desc:'Gas noble genérico — plasma suave, kriptón y similares',           family:'gas',        pipeline: pipe(ps(1.8,0,1), blnk(.7,.22,1.7), disc(.46,.32,0), bright(2.5,.35,.15), grade(.75,.85,1.7,.95), glow(1.3,5.5,.38), alpha(.7,.55,.01)) },
  hydrogen_gas:       { name:'Hydrogen Gas',        desc:'Hidrógeno — nube tenue casi transparente, blanco puro',            family:'gas',        pipeline: pipe(ps(1.4,0,1), pulse(3,.1,0), disc(.44,.40,0), bright(.8,.15,.04), grade(1,1,1,1), glow(.3,10,.2), alpha(.5,.28,0)) },
  oxygen_gas:         { name:'Oxygen Gas',          desc:'Oxígeno — nube azul-blanca fría, paramagnético',                   family:'gas',        pipeline: pipe(ps(1.5,0,1), pulse(2.5,.09,0), disc(.45,.38,0), bright(1,.18,.06), grade(.6,.8,1.5,1), glow(.4,9,.22), alpha(.55,.32,0)) },
  nitrogen_gas:       { name:'Nitrogen Gas',        desc:'Nitrógeno — gas azul muy diluido, casi inerte',                    family:'gas',        pipeline: pipe(ps(1.5,0,1), disc(.44,.40,0), bright(.85,.15,.04), grade(.5,.65,1.6,1), glow(.35,10,.18), alpha(.5,.28,0)) },
  corrosive_fluorine: { name:'Corrosive Fluorine',  desc:'Flúor — gas amarillo-verdoso tóxico y corrosivo',                  family:'gas',        pipeline: pipe(ps(1.6,0,1), blnk(1.5,.25,2.5), disc(.45,.34,0), bright(2,.3,.18), grade(1.4,1.6,.1,.95), glow(.7,7,.3), alpha(.65,.48,.01)) },
  toxic_chlorine:     { name:'Toxic Chlorine',      desc:'Cloro — gas verde-amarillo denso, tóxico',                         family:'gas',        pipeline: pipe(ps(1.7,0,1), blnk(1,.2,2), disc(.45,.32,0), bright(1.8,.28,.14), grade(.8,1.8,.2,.95), glow(.6,7.5,.28), alpha(.65,.45,.01)) },
  gas_volume:         { name:'Gas Volume',          desc:'Gas volumen genérico — nube dispersa suave',                       family:'gas',        pipeline: pipe(ps(1.5,0,1), disc(.44,.40,0), bright(.9,.16,.06), grade(.9,.95,1.05,1), glow(.3,10,.18), alpha(.55,.3,0)) },
  soft_lithium:       { name:'Soft Lithium',        desc:'Litio — metal plateado suave, ligeramente dorado',                 family:'metal',      pipeline: pipe(ps(2.2,.06,1), pulse(.5,.04,0), disc(.48,.28,0), bright(1.5,.4,.15), grade(.95,.95,.88,1.05), frsnl(.9,.25,2.2,1,.98,.9), alpha(1.2,.88,.08)) },
  reactive_sodium:    { name:'Reactive Sodium',     desc:'Sodio — metal brillante reactivo, lustre blanco-plata',            family:'metal',      pipeline: pipe(ps(2.3,.07,1), pulse(.6,.05,0), disc(.48,.26,0), bright(1.6,.42,.18), grade(1,1,.95,1.05), frsnl(1,.28,2,1,1,.95), alpha(1.2,.9,.08)) },
  reactive_potassium: { name:'Reactive Potassium',  desc:'Potasio — metal muy blando, plateado mate',                        family:'metal',      pipeline: pipe(ps(2.3,.06,1), pulse(.5,.04,0), disc(.48,.30,0), bright(1.4,.38,.14), grade(.95,.95,.92,1.05), frsnl(.8,.22,2.2,.98,.98,.95), alpha(1.2,.86,.07)) },
  reactive_metal:     { name:'Reactive Metal',      desc:'Rubidio/Francio — metal alcalino suave, plateado opaco',           family:'metal',      pipeline: pipe(ps(2.2,.06,1), disc(.48,.32,0), bright(1.3,.35,.12), grade(.95,.93,.9,1.05), frsnl(.7,.2,2.5,.97,.97,.94), alpha(1.2,.84,.07)) },
  soft_metal:         { name:'Soft Metal',          desc:'Cesio — metal alcalino dorado-amarillento muy suave',              family:'metal',      pipeline: pipe(ps(2.2,.06,1), disc(.48,.30,0), bright(1.4,.38,.14), grade(1.2,1.1,.7,1.05), frsnl(.9,.25,2,1.2,1.05,.6), alpha(1.2,.86,.08)) },
  polished_metal:     { name:'Polished Metal',      desc:'Metal pulido genérico — aluminio, calcio, hafnio, bario',          family:'metal',      pipeline: pipe(ps(2.2,.06,1), pulse(.6,.04,0), disc(.48,.26,0), bright(1.5,.38,.16), grade(.88,.92,1,1.1), frsnl(1.1,.28,2.2,.9,.95,1), alpha(1.3,.88,.07)) },
  metallic_base:      { name:'Metallic Base',       desc:'Metal base genérico — transiciones medias, escandio, niobio',      family:'metal',      pipeline: pipe(ps(2.2,.07,1), pulse(.6,.04,0), disc(.48,.28,0), bright(1.4,.36,.16), grade(.86,.9,.98,1.1), frsnl(1,.26,2.3,.88,.93,1), alpha(1.3,.86,.06)) },
  metallic:           { name:'Metallic',            desc:'Metal transición genérico — Sc, V, Ga, Ru, Rh, Sn, Ta, Tl, Re, Pt',family:'metal',     pipeline: pipe(ps(2.2,.07,1), pulse(.6,.04,0), disc(.48,.28,0), bright(1.4,.36,.16), grade(.88,.92,.98,1.08), frsnl(1,.26,2.3,.9,.94,1), alpha(1.3,.86,.06)) },
  dark_metal:         { name:'Dark Metal',          desc:'Metal oscuro/refractario — Be, Zr, Mo, Tc, In, superpesados',      family:'metal',      pipeline: pipe(ps(2.1,.06,1), disc(.48,.30,0), bright(1.2,.28,.12), grade(.7,.75,.8,1.15), frsnl(.8,.3,2.8,.75,.78,.85), alpha(1.3,.82,.06)) },
  metallic_copper:    { name:'Metallic Copper',     desc:'Cobre — rojizo-dorado cálido, brillo sedoso',                      family:'metal',      pipeline: pipe(ps(2.2,.07,1), pulse(.7,.05,0), disc(.48,.25,0), bright(1.6,.4,.18), grade(1.5,.75,.35,1), frsnl(1.3,.3,2,1.5,.7,.3), alpha(1.2,.9,.08)) },
  metallic_gold:      { name:'Metallic Gold',       desc:'Oro/Paladio — dorado intenso, reflejo caliente',                   family:'metal',      pipeline: pipe(ps(2.3,.08,1), pulse(.5,.04,0), disc(.48,.24,0), bright(1.8,.45,.2), grade(1.6,1.2,.25,1), frsnl(1.5,.32,1.8,1.6,1.1,.2), alpha(1.2,.92,.09)) },
  metallic_silver:    { name:'Metallic Silver',     desc:'Plata — reflejo frío, especular muy alto',                         family:'metal',      pipeline: pipe(ps(2.3,.07,1), pulse(.5,.04,0), disc(.48,.22,0), bright(1.9,.45,.18), grade(.88,.95,1.05,1.05), frsnl(1.6,.3,1.8,.9,.97,1.05), alpha(1.2,.93,.08)) },
  magnetic_iron:      { name:'Magnetic Iron',       desc:'Hierro — gris metálico mate, textura rugosa',                      family:'metal',      pipeline: pipe(ps(2.1,.08,1), pulse(.8,.05,0), disc(.48,.28,0), bright(1.3,.32,.14), grade(.82,.82,.85,1.1), frsnl(.75,.35,3,.85,.85,.88), alpha(1.3,.84,.07)) },
  magnetic_metal:     { name:'Magnetic Metal',      desc:'Magnesio/Moscovio — metal ligero, gris-plata suave',               family:'metal',      pipeline: pipe(ps(2.2,.06,1), disc(.48,.28,0), bright(1.4,.36,.14), grade(.9,.93,.95,1.08), frsnl(.95,.26,2.4,.92,.95,.97), alpha(1.25,.86,.06)) },
  nickel_magnetic:    { name:'Nickel Magnetic',     desc:'Níquel — plateado-cálido, ferromagnético',                         family:'metal',      pipeline: pipe(ps(2.2,.07,1), pulse(.7,.04,0), disc(.48,.26,0), bright(1.5,.38,.16), grade(1,.96,.88,1.08), frsnl(1.05,.28,2.2,1.02,.98,.88), alpha(1.25,.88,.07)) },
  cobalt_blue:        { name:'Cobalt Blue',         desc:'Cobalto — metálico con tinte azul-gris, ferromagnético',           family:'metal',      pipeline: pipe(ps(2.2,.07,1), pulse(.7,.05,0), disc(.48,.26,0), bright(1.5,.38,.16), grade(.8,.88,1.1,1.08), frsnl(1.1,.28,2.1,.82,.9,1.15), alpha(1.25,.88,.07)) },
  chrome_sheen:       { name:'Chrome Sheen',        desc:'Cromo — espejo frío, reflejo azul-hielo intenso',                  family:'metal',      pipeline: pipe(ps(2.3,.06,1), disc(.48,.20,0), bright(2,.45,.14), grade(.82,.92,1.08,1.05), frsnl(1.8,.25,1.6,.85,.95,1.1), alpha(1.2,.94,.07)) },
  titanium_light:     { name:'Titanium Light',      desc:'Titanio — gris azulado ligero, refractario elegante',              family:'metal',      pipeline: pipe(ps(2.2,.06,1), disc(.48,.26,0), bright(1.5,.38,.14), grade(.84,.9,1,1.08), frsnl(1.1,.28,2.3,.86,.92,1.02), alpha(1.25,.88,.07)) },
  tungsten_hard:      { name:'Tungsten Hard',       desc:'Tungsteno — gris oscuro muy denso, refractario máximo',            family:'metal',      pipeline: pipe(ps(2.1,.05,1), disc(.48,.30,0), bright(1.2,.28,.1), grade(.72,.74,.78,1.15), frsnl(.7,.35,3.2,.75,.77,.82), alpha(1.35,.82,.06)) },
  manganese_oxide:    { name:'Manganese Oxide',     desc:'Manganeso — gris-rosado pálido, tendencia oxidada',                family:'metal',      pipeline: pipe(ps(2.1,.07,1), disc(.48,.30,0), bright(1.3,.32,.14), grade(1.05,.88,.85,1.1), frsnl(.85,.3,2.6,1.08,.9,.87), alpha(1.3,.84,.07)) },
  zinc_dull:          { name:'Zinc Dull',           desc:'Zinc — plateado-azulado opaco, lustre mate',                       family:'metal',      pipeline: pipe(ps(2.1,.06,1), disc(.48,.32,0), bright(1.3,.32,.12), grade(.85,.88,.95,1.1), frsnl(.8,.3,2.8,.87,.9,.98), alpha(1.3,.82,.06)) },
  liquid_mercury:     { name:'Liquid Mercury',      desc:'Mercurio — espejo líquido, reflejo perfecto frío',                 family:'liquid',     pipeline: pipe(ps(2.4,.04,1), pulse(3,.12,0), disc(.48,.18,0), bright(2.2,.5,.1), grade(.82,.9,1,1), frsnl(2.2,.2,1.4,.85,.93,1.02), alpha(1.1,.96,.1)) },
  lead_heavy:         { name:'Lead Heavy',          desc:'Plomo — gris azulado muy denso, opaco',                            family:'metal',      pipeline: pipe(ps(2.1,.05,1), disc(.48,.32,0), bright(1.2,.28,.1), grade(.78,.8,.88,1.12), frsnl(.7,.32,3,.8,.83,.92), alpha(1.35,.8,.06)) },
  bismuth_crystal:    { name:'Bismuth Crystal',     desc:'Bismuto — iridiscente multicolor, cristal escalonado',             family:'crystal',    pipeline: pipe(ps(2.2,.08,1), pulse(.8,.06,0), disc(.46,.22,0), bright(1.6,.42,.2), grade(1.1,.85,1.2,1), frsnl(1.8,.3,1.8,1.1,.7,1.3), phase(1.5,.3,1.5), alpha(1.1,.88,.08)) },
  liquid_bromine:     { name:'Liquid Bromine',      desc:'Bromo — líquido rojo-marrón tóxico y volátil',                     family:'liquid',     pipeline: pipe(ps(2,.08,1), pulse(1.5,.08,0), disc(.46,.32,0), bright(1.7,.4,.2), grade(1.6,.35,.1,.95), glow(.5,6,.25), alpha(1.1,.78,.05)) },
  liquid_base:        { name:'Liquid Base',         desc:'Líquido genérico — azul-verde neutro',                             family:'liquid',     pipeline: pipe(ps(2,.08,1), pulse(1.5,.07,0), disc(.46,.32,0), bright(1.4,.35,.16), grade(.5,.85,1.2,1), glow(.4,7,.22), alpha(1.1,.72,.04)) },
  silicon_wafer:      { name:'Silicon Wafer',       desc:'Silicio — azul-gris oscuro metálico, brillo interferencial',       family:'crystal',    pipeline: pipe(ps(2.1,.05,1), disc(.46,.24,0), bright(1.4,.35,.12), grade(.72,.78,.98,1.08), frsnl(1.2,.32,2.4,.75,.82,1.05), phase(1.3,.35,1.8), alpha(1.2,.86,.07)) },
  boron_ceramic:      { name:'Boron Ceramic',       desc:'Boro — negro-marrón cristalino, dureza extrema',                   family:'crystal',    pipeline: pipe(ps(2,.05,1), disc(.46,.26,0), bright(1.2,.28,.1), grade(.65,.5,.38,1.15), frsnl(.7,.35,3,.7,.55,.42), alpha(1.3,.82,.06)) },
  carbon_allotrope:   { name:'Carbon Allotrope',    desc:'Carbono — negro profundo, grafito / diamante / fullereno',         family:'crystal',    pipeline: pipe(ps(2,.06,1), disc(.46,.25,0), bright(1.2,.25,.12), grade(.62,.62,.65,1.1), frsnl(1,.4,2,.65,.65,.68), phase(1.6,.2,1.4), alpha(1.25,.84,.06)) },
  semi_metallic:      { name:'Semi Metallic',       desc:'Metaloide semimetálico — arsénico / germanio, gris-plata',         family:'crystal',    pipeline: pipe(ps(2.1,.06,1), disc(.46,.26,0), bright(1.3,.32,.12), grade(.78,.82,.88,1.1), frsnl(.9,.3,2.5,.82,.86,.92), alpha(1.25,.84,.07)) },
  semiconductor:      { name:'Semiconductor',       desc:'Semiconductor — antimonio, tinte plateado-azulado',                family:'crystal',    pipeline: pipe(ps(2.1,.06,1), disc(.46,.26,0), bright(1.3,.32,.12), grade(.8,.85,1,1.1), frsnl(.95,.3,2.5,.82,.88,1.02), alpha(1.25,.84,.07)) },
  sulfur_crystal:     { name:'Sulfur Crystal',      desc:'Azufre — cristal amarillo brillante, translúcido',                 family:'crystal',    pipeline: pipe(ps(2.1,.07,1), pulse(1,.06,0), disc(.46,.26,0), bright(1.8,.42,.2), grade(1.8,1.5,.1,.95), frsnl(1.2,.25,2,1.8,1.5,.12), phase(1.5,.5,1.2), alpha(1.1,.82,.06)) },
  iodine_crystal:     { name:'Iodine Crystal',      desc:'Yodo — cristal violeta oscuro metálico',                           family:'crystal',    pipeline: pipe(ps(2.1,.06,1), disc(.46,.25,0), bright(1.5,.38,.15), grade(.6,.25,.75,1.05), frsnl(1.1,.3,2.2,.65,.28,.8), phase(1.4,.3,1.5), alpha(1.2,.84,.07)) },
  crystal_grey:       { name:'Crystal Grey',        desc:'Cristal gris — telurio / polonio, semimetálico brillante',         family:'crystal',    pipeline: pipe(ps(2.1,.06,1), disc(.46,.26,0), bright(1.4,.36,.14), grade(.82,.85,.9,1.08), frsnl(1,.3,2.4,.85,.88,.94), phase(1.3,.35,1.6), alpha(1.2,.84,.07)) },
  crystal_base:       { name:'Crystal Base',        desc:'Cristal base genérico — blanco translúcido',                       family:'crystal',    pipeline: pipe(ps(2,.06,1), disc(.46,.26,0), bright(1.4,.36,.14), grade(.95,.97,1.02,1.05), frsnl(1,.28,2.2,.97,.99,1.02), alpha(1.15,.82,.07)) },
  organic_solid:      { name:'Organic Solid',       desc:'Sólido orgánico — selenio, rojo-gris, textura cerosa',             family:'crystal',    pipeline: pipe(ps(2,.07,1), disc(.46,.30,0), bright(1.4,.35,.16), grade(1.2,.4,.3,1.05), frsnl(.8,.3,2.5,1.25,.42,.32), phase(1.4,.4,1.2), alpha(1.2,.82,.07)) },
  lanthanide_base:    { name:'Lanthanide Base',     desc:'Lantánido base — plateado sedoso, lustre suave',                   family:'lanthanide', pipeline: pipe(ps(3.2,.04,1), pulse(.3,.03,0), disc(.48,.24,0), bright(1.5,.48,.12), phase(1.4,.52,1.8), frsnl(1.5,.2,2.5,1,.95,.85), grade(1,.95,.82,1.05), alpha(1,.88,.11)) },
  lanthanide_surface: { name:'Lanthanide Surface',  desc:'Lantánido superficie — perla metálica sedosa, lustre nacarado',    family:'lanthanide', pipeline: pipe(ps(3.8,.04,1), pulse(.3,.03,0), disc(.48,.22,0), bright(1.5,.5,.12), phase(1.4,.55,1.8), frsnl(1.6,.2,2.5,1,.95,.85), grade(1,.94,.8,1.05), alpha(1,.9,.12)) },
  lanthanide_sheen:   { name:'Lanthanide Sheen',    desc:'Lantánido sheen — lustre nacarado cálido, La a Lu',                family:'lanthanide', pipeline: pipe(ps(3.5,.04,1), pulse(.3,.03,0), disc(.48,.23,0), bright(1.5,.5,.12), phase(1.4,.52,1.8), frsnl(1.55,.2,2.5,1,.95,.85), grade(1,.95,.82,1.05), alpha(1,.89,.12)) },
  rare_earth_metal:   { name:'Rare Earth Metal',    desc:'Tierra rara — neodimio / holmio, tinte metálico cálido',           family:'lanthanide', pipeline: pipe(ps(3.4,.05,1), disc(.48,.24,0), bright(1.5,.48,.14), phase(1.5,.45,2), frsnl(1.5,.22,2.3,1.05,.92,.8), grade(1.05,.92,.78,1.05), alpha(1,.88,.11)) },
  radioactive_base:   { name:'Radioactive Base',    desc:'Radiactivo base — glow verde suave, peligroso',                    family:'radioactive',pipeline: pipe(ps(2.2,.1,1), blnk(.8,.3,1.5), disc(.46,.28,0), bright(2,.35,.2), grade(.3,1.2,.2,.95), glow(1,5,.4), alpha(1,.72,.04)) },
  radioactive_glow:   { name:'Radioactive Glow',    desc:'Radiactivo brillante — Ac, Am, Cm, Fm, Lr, Md — verde-amarillo',   family:'radioactive',pipeline: pipe(ps(2.2,.12,1), blnk(1,.35,1.8), disc(.46,.26,0), bright(2.5,.38,.25), grade(.5,1.4,.1,.9), glow(1.5,4.5,.5), alpha(.9,.7,.04)) },
  radioactive_uranium:{ name:'Radioactive Uranium', desc:'Uranio — metálico gris-oliva denso, glow verde tenue',             family:'radioactive',pipeline: pipe(ps(2.2,.1,1), pulse(.6,.05,0), disc(.48,.26,0), bright(1.6,.38,.18), grade(.7,.8,.45,1.05), frsnl(.9,.32,2.5,.72,.82,.48), glow(.6,6,.25), alpha(1.2,.84,.07)) },
  radioactive_radium: { name:'Radioactive Radium',  desc:'Radio — blanco-plateado luminiscente, leve glow azul',             family:'radioactive',pipeline: pipe(ps(2.2,.1,1), blnk(.7,.28,1.6), disc(.47,.27,0), bright(2,.4,.2), grade(.85,.92,1.1,1), glow(1.2,5,.42), alpha(1,.74,.04)) },
  radioactive_radon:  { name:'Radioactive Radon',   desc:'Radón — gas noble radiactivo, glow azul-violeta oscuro',           family:'radioactive',pipeline: pipe(ps(1.8,.08,1), blnk(.9,.28,1.7), disc(.46,.30,0), bright(2.2,.36,.18), grade(.5,.3,1.5,.95), glow(1.3,5.5,.45), alpha(.85,.6,.02)) },
  nuclear_metal:      { name:'Nuclear Metal',       desc:'Metal nuclear — Th, Np, Es — gris-plata denso, peligroso',         family:'radioactive',pipeline: pipe(ps(2.2,.09,1), disc(.48,.28,0), bright(1.5,.36,.14), grade(.8,.82,.78,1.1), frsnl(.85,.32,2.7,.82,.85,.8), glow(.5,7,.2), alpha(1.25,.82,.07)) },
  actinide_bloom:     { name:'Actinide Bloom',      desc:'Actínido bloom — Pa, Pu, Bk, Cf, No — glow radiactivo tenue',      family:'radioactive',pipeline: pipe(ps(2.2,.1,1), blnk(.8,.3,1.6), disc(.47,.27,0), bright(1.8,.36,.2), grade(.55,.9,.5,.95), glow(1,5.5,.38), alpha(1,.72,.04)) },
};

export const MAT_KEYS = Object.keys(MATERIALS);

// ══════════════════════════════════════════════════════════════════════════════
//  GENERACIÓN DESDE PARAMS FÍSICOS
//  Traduce src/material_params/{sym}_params.json → pipeline del ShaderLab
//  Reemplaza los pipelines hardcodeados por física real (generate_materials.py)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Carga los params físicos de un elemento y construye su pipeline.
 * @param {string} sym — símbolo del elemento (ej: 'Fe', 'H')
 * @returns {Promise<Array|null>} — pipeline o null si no hay params
 */
export async function buildPipelineFromParams(sym) {
  try {
    const res = await fetch(`../../src/material_params/${sym}_params.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return paramsToDevPipeline(data.shader_params, data.source_props);
  } catch { return null; }
}

/**
 * Convierte shader_params (de generate_materials.py) a pipeline del devMode.
 * @param {Object} sp  — shader_params del JSON de params
 * @param {Object} src — source_props para ajustes adicionales (opcional)
 */
function paramsToDevPipeline(sp, src = {}) {
  const nodes = [];

  // ── point_size — siempre activo ──────────────────────────────────────────
  nodes.push(ps(
    sp.point_size?.sz    ?? 1.0,
    sp.point_size?.bAmp  ?? 0.0,
    sp.point_size?.persp ?? 50.0
  ));

  // ── sphere_pulse — activar si amp > 0.1 ──────────────────────────────────
  const pulseAmp = sp.sphere_pulse?.amp ?? 0;
  if (pulseAmp > 0.05) {
    nodes.push(pulse(
      sp.sphere_pulse?.freq  ?? 2.0,
      pulseAmp,
      sp.point_size?.sz      ?? 1.0
    ));
  }

  // ── blink — activar solo en elementos reactivos (blink.amp > 0.05) ───────
  const blinkAmp = sp.blink?.amp ?? 0;
  if (blinkAmp > 0.05) {
    nodes.push(blnk(
      sp.blink?.speed ?? 0.5,
      blinkAmp,
      1.5
    ));
  }

  // ── disc_shape — siempre activo ───────────────────────────────────────────
  nodes.push(disc(
    0.46,                          // radio fijo — funciona bien para todos
    sp.disc_shape?.soft ?? 0.25,
    0.0
  ));

  // ── brightness — siempre activo ───────────────────────────────────────────
  nodes.push(bright(
    sp.brightness?.bright ?? 1.5,
    sp.brightness?.base   ?? 0.35,
    sp.brightness?.vari   ?? 0.0
  ));

  // ── color_grade — siempre activo, color del elemento ─────────────────────
  const c = sp.color ?? { r: 1, g: 1, b: 1 };
  // Gamma más alto para elementos más opacos (densidad alta)
  const opacity = sp.alpha_curve?.opacity ?? 0.7;
  const gamma   = opacity > 0.8 ? 1.1 : 1.0;
  nodes.push(grade(c.r, c.g, c.b, gamma));

  // ── glow — activar para gases y elementos ligeros (opacity < 0.4) ────────
  if (opacity < 0.45) {
    nodes.push(glow(0.5, 8, 0.28));
  }

  // ── fresnel — activar para metales (opacity > 0.7) ───────────────────────
  if (opacity > 0.65) {
    nodes.push(frsnl(1.0, 0.28, 2.2, c.r, c.g, c.b));
  }

  // ── alpha_curve — siempre activo ─────────────────────────────────────────
  nodes.push(alpha(
    sp.alpha_curve?.curve   ?? 1.0,
    sp.alpha_curve?.opacity ?? 0.7,
    0.0
  ));

  return nodes;
}

// ── Construir JSON compilable de un material ──────────────────
export function buildMatJSON(key, moduleDefs, overridePipeline = null, elemIndex = null) {
  // En el nuevo paradigma key es un símbolo de elemento (H, Fe...)
  // Buscar metadata en elemIndex si está disponible, MATERIALS como fallback legacy
  const m = MATERIALS[key] ?? null;
  const el = elemIndex?.[key] ?? null;

  // Necesitamos un pipeline — override, MATERIALS legacy, o mínimo
  const rawPipeline = overridePipeline ?? m?.pipeline;
  if (!rawPipeline) return null;

  // Hidratar nodos con defs reales del moduleDefs del ShaderLab
  const hydratedPipeline = rawPipeline.map(node => {
    const def = moduleDefs.find(d => d.id === node.key);
    return { ...node, def, id: Math.random().toString(36).slice(2) };
  });

  // Compilar
  let compiled = { vert: '', frag: '' };
  try {
    compiled = compilePipeline(hydratedPipeline, 'sphere');
  } catch (e) {
    console.warn(`[DevMode] compile error ${key}:`, e.message);
  }

  // Nombre y descripción desde elemIndex o MATERIALS legacy
  const name    = el ? `${key} — ${el.name_es ?? el.name_eng ?? key}` : (m?.name ?? key);
  const desc    = el ? `Material generado para ${el.name_es ?? key} (Z:${el.number ?? '?'})` : (m?.desc ?? '');
  const family  = el?.group ?? m?.family ?? null;

  return {
    version: '3.0',
    created: new Date().toISOString(),
    name,
    description: desc,
    family,
    mode:    'custom',
    target:  'sphere',
    layer:   'all',
    element: key,
    pipeline: hydratedPipeline.map(node => ({
      key:     node.key,
      enabled: node.enabled,
      params:  { ...node.params },
      custom:  false,
    })),
    compiled,
  };
}

// ── Generar index.json ────────────────────────────────────────
export function buildIndex(keys) {
  return { version: '1.0', materials: [...keys].sort() };
}

// ── Intentar cargar material existente desde /src/materials/ ──
export async function tryLoadExisting(key) {
  try {
    const res = await fetch(`../src/materials/${key}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Generar y descargar ZIP ───────────────────────────────────
// Usa JSZip si está disponible, si no descarga uno por uno
export async function downloadZip(keys, moduleDefs, overrides = {}, elemIndex = null) {
  const files = {};
  for (const key of keys) {
    const pipeline = overrides[key] ?? null;
    const json = buildMatJSON(key, moduleDefs, pipeline, elemIndex);
    files[`${key}.json`] = JSON.stringify(json, null, 2);
  }
  files['index.json'] = JSON.stringify(buildIndex(keys), null, 2);

  // Intentar JSZip
  if (typeof JSZip !== 'undefined') {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files))
      zip.file(name, content);
    const blob = await zip.generateAsync({ type: 'blob' });
    _download(blob, 'materials.zip');
    return;
  }

  // Fallback: descargar archivo por archivo
  for (const [name, content] of Object.entries(files)) {
    const blob = new Blob([content], { type: 'application/json' });
    _download(blob, name);
    await new Promise(r => setTimeout(r, 80));
  }
}

function _download(blob, name) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: name,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Guardar con File System Access API ───────────────────────
export async function saveToDir(dirHandle, keys, moduleDefs, overrides = {}, elemIndex = null) {
  let ok = 0, err = 0;
  for (const key of keys) {
    try {
      const json = buildMatJSON(key, moduleDefs, overrides[key] ?? null, elemIndex);
      const fh = await dirHandle.getFileHandle(`${key}.json`, { create: true });
      const w  = await fh.createWritable();
      await w.write(JSON.stringify(json, null, 2));
      await w.close();
      ok++;
    } catch { err++; }
  }
  // index.json
  try {
    const fh = await dirHandle.getFileHandle('index.json', { create: true });
    const w  = await fh.createWritable();
    await w.write(JSON.stringify(buildIndex(keys), null, 2));
    await w.close();
  } catch { err++; }
  return { ok, err };
}
