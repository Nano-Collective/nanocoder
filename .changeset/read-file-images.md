---
"@nanocollective/nanocoder": minor
---

`read_file` now returns image files (PNG, JPEG, GIF and WebP, up to 10 MB) as images, so a vision-capable model can look at screenshots, diagrams and design mock-ups in your project without you attaching them. Models that do not accept images get a short note instead of the image. Thanks to @vyb2306697. Closes #2021.
