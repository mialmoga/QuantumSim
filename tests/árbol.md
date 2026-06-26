# 📂 QuantumSim

> Generado el 2026-06-01 06:09:41  
> Ruta: `/storage/emulated/0/01-tutorial/QuantumSimLastRelease/QuantumSim`

```
📁 QuantumSim/
├── 📁 components/
│   ├── 📁 mediapipe/
│   │   ├── @mediapipe_hands CDN by jsDelivr - A free, fast, and reliable Open Source CDN
│   │   ├── hand_landmark_full.tflite
│   │   ├── hand_landmark_lite.tflite
│   │   ├── hands.binarypb
│   │   ├── hands.js
│   │   ├── hands_solution_packed_assets.data
│   │   ├── hands_solution_packed_assets_loader.js
│   │   ├── hands_solution_simd_wasm_bin.js
│   │   ├── hands_solution_simd_wasm_bin.wasm
│   │   ├── hands_solution_wasm_bin.js
│   │   ├── hands_solution_wasm_bin.wasm
│   │   ├── package.json
│   │   └── README.md
│   ├── marked.min.js
│   ├── prism-bash.min.js
│   ├── prism-c.min.js
│   ├── prism-css.min.js
│   ├── prism-glsl.min.js
│   ├── prism-javascript.min.js
│   ├── prism-json.min.js
│   ├── prism-markup.min.js
│   ├── prism-python.min.js
│   ├── prism-tomorrow.min.css
│   ├── prism.min.js
│   └── twcss.js
├── 📁 css/
│   ├── base.css
│   ├── loader.css
│   ├── panels.css
│   ├── quantum-view.css
│   ├── ui.css
│   └── variables.css
├── 📁 data/
│   ├── deformaciones_nucleares_qcs.json
│   ├── LCAO.json
│   └── moleculas.json
├── 📁 js/
│   ├── quantum-view.js
│   └── quantum-view.js.old
├── 📁 lib/
├── 📁 ShaderLab/
│   ├── 📁 assets/
│   │   ├── 📁 fonts/
│   │   │   ├── MiSansVF_Overlay.ttf
│   │   │   ├── MiSansVF_Overlay.woff
│   │   │   └── MiSansVF_Overlay.woff2
│   │   └── 📁 icons/
│   │       ├── android-chrome-192x192.png
│   │       ├── android-chrome-512x512.png
│   │       ├── apple-touch-icon.png
│   │       ├── favicon-16x16.png
│   │       ├── favicon-32x32.png
│   │       └── favicon.ico
│   ├── 📁 css/
│   │   └── shaderlab.css
│   ├── 📁 exports/
│   │   ├── shader_custom_orbital_1772975197922.json
│   │   └── shader_custom_orbital_1773106886366.json
│   ├── 📁 js/
│   │   ├── app.js
│   │   ├── compiler.js
│   │   ├── devMode.js
│   │   ├── jszip.min.js
│   │   ├── preview.js
│   │   └── ui.js
│   ├── 📁 shader_modules/
│   │   ├── 📁 presets/
│   │   │   ├── fe_3d_rings.json
│   │   │   └── fe_nebula.json
│   │   ├── alpha_curve.json
│   │   ├── blink.json
│   │   ├── brightness.json
│   │   ├── color_grade.json
│   │   ├── disc_shape.json
│   │   ├── especular_metal.json
│   │   ├── fresnel_fake.json
│   │   ├── glow.json
│   │   ├── phase_color.json
│   │   ├── point_size.json
│   │   ├── sphere_pulse.json
│   │   └── turbulence.json
│   ├── favicon.ico
│   └── index.html
├── 📁 src/
│   ├── 📁 audio/
│   │   └── SoundEngine.js
│   ├── 📁 camera/
│   │   └── CinematicCamera.js
│   ├── 📁 core/
│   │   ├── Atom.js
│   │   ├── Bond.js
│   │   └── World.js
│   ├── 📁 data/
│   │   ├── ElementLoader.js
│   │   ├── i18n.js
│   │   └── LibraryIndex.js
│   ├── 📁 i18n/
│   │   ├── en.json
│   │   └── es.json
│   ├── 📁 input/
│   │   ├── GestureController.js
│   │   ├── GestureIntegration.js
│   │   └── GestureOverlay.js
│   ├── 📁 library/
│   │   ├── 📁 crystals/
│   │   │   └── NaCl.cqcs
│   │   ├── 📁 environments/
│   │   │   └── earth_surface.eqcs
│   │   ├── 📁 molecules/
│   │   │   └── H2O.mqcs
│   │   └── library_index.json
│   ├── 📁 physics/
│   │   ├── Constants.js
│   │   ├── PhysicsWorker.js
│   │   └── WorldBridge.js
│   ├── 📁 renderer/
│   │   ├── MaterialLibrary.js
│   │   ├── NuclearFieldBaker.js
│   │   ├── NucleusBuilder.js
│   │   ├── OrbitalBuilder.js
│   │   ├── OrbitalCache.js
│   │   ├── QuantumRenderer.js
│   │   ├── QuantumRendererPool.js
│   │   └── shaders.js
│   ├── 📁 structures/
│   │   ├── CrystalFactory.js
│   │   ├── MoleculeFactory.js
│   │   └── SnowflakeFactory.js
│   ├── 📁 ui/
│   │   ├── AddPanel.js
│   │   ├── Console.js
│   │   ├── ElementSelector.js
│   │   ├── FPSJoystick.js
│   │   ├── GroupPanel.js
│   │   ├── panels.js
│   │   ├── PhysicsPanel.js
│   │   └── SessionSetup.js
│   ├── elements-index.json
│   └── groups-index.json
├── 01-bake_orbitals_v8.py
├── 02-generate_materials.py
├── 03-ShaderLab.txt
├── 04-generate_materials_ml.py
├── app.js
├── favicon.ico
├── index.html
├── main.css
├── mapear_folder.py
├── md.html
├── model_weights.json
├── QuantumView.html
├── site.webmanifest
└── árbol.md
```

---

**30** carpetas · **125** archivos