# GF-CR — Escáner sin gluten (Costa Rica)

Spec y decisiones: vault personal, `04-Aprendizaje/Proyectos/escaner-sin-gluten-spec-v1.md`.

- `web/` — PWA (GitHub Pages). Interfaz calcada en flujo y medidas de *The Gluten Free Scanner* 2.3.6; código, HTML/CSS e íconos propios.
- `apps-script/` — API JSON (`clasp`, script `GF-CR API`). `setup()` crea la Sheet `GF-CR datos` y la carpeta `GF-CR fotos`.

Desplegar API: `cd apps-script && npx @google/clasp@3.4.1 push -f && npx @google/clasp@3.4.1 update-deployment <ID>`.
Probar la regla sin Google: `node -e` sobre `Code.gs` + `probarRegla()` (19 casos).
