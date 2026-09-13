# Cloud model audit

Asset: `static/assets/models/ship_in_clouds.glb`

## Structure

The GLB contains six independent root nodes rather than a level hierarchy:

| Node | World-space size (x × y × z) | Intended use |
| --- | --- | --- |
| `Sky_Mat_0` | 12.02 × 12.02 × 12.02 | Enclosing decorative sky shell |
| `Boot_Finaal_1_Boot_Finaal_0` | 0.57 × 1.57 × 0.45 | Ship |
| `Cloud_Poly_Poly_0` | 4.01 × 1.80 × 6.73 | Opaque cloud layer |
| `Cloud_1_Cloud_1_0` | 4.31 × 1.93 × 6.94 | Blended cloud layer |
| `Cloud_2_Cloud_2_0` | 4.24 × 1.96 × 6.98 | Blended cloud layer |
| `Cloud_3_Cloud_3_0` | 4.22 × 1.92 × 6.89 | Masked cloud layer |

The cloud layers occupy almost the same volume. Together they create the exterior illusion of a dense cloud, but they do not form rooms, tunnels, paths, or a navigable interior. The ship is tiny relative to the cloud and sky shell.

## Geometry and materials

- The file has no animation, camera, collision mesh, navigation surface, or gameplay metadata.
- The scene contains about 64,000 rendered triangles.
- Every material uses a black base-color factor and relies primarily on baked emissive textures.
- Two cloud materials use alpha blending and one uses alpha masking.
- All materials are double-sided.

This explains the current rendering failure: outside, the overlapping emissive/transparent layers clip toward white under high exposure and bloom; inside, their back faces and dark baked textures surround the camera and read almost black. Adding more conventional lights cannot make this asset behave like a purpose-built interior.

## Verdict

This GLB is **not suitable as literal explorable level geometry**. It should be used as distant scenery or separated into decorative ship/cloud pieces.

The existing root-node separation means the sky, ship, and cloud layers can be enabled, hidden, and positioned independently without editing the binary model. That is enough for scenery, but it does not create a playable cloud platform.

## V1 implementation decision

The source is not used as literal level geometry. V1 separates the ship and one
recognizable cloud mesh, then reuses that cloud twice: an enlarged canopy above
the player and a flattened visual surface below. A procedural enclosing cloud
shell prevents the camera from leaving the atmosphere. Movement samples the
visible lower cloud with a downward ray, including its real gaps, while a low
rescue floor keeps a fall recoverable. The old full-width invisible collision
plane was removed because it bridged visible pits.

The ship, moon, scroll, and birds remain independent interactive landmarks.
This arrangement delivers the requested single-cloud interior without loading
another environment model. A purpose-built modular cloud island would still be
a possible future visual upgrade, but it is not required for V1.
