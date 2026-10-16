---
created: 2026-03-02
tags: [software, graphics]
---
# Shaders

Small programs that run on the GPU, once per vertex or once per pixel. A glowing node is just a falloff curve:

```glsl
float glow = pow(max(0.0, 1.0 - d), 2.5); // [[Not A Link]]
```

Bloom spreads the brightest pixels outward, which is what makes [[Nebulae]] photos and neon both feel lit from inside. They run on [[WebGL]].
