
# Image Assistant Plugin - Important Notice

By installing and using this plugin, you acknowledge and agree to the following terms:

## ⚠️ Important Disclaimers

1. **File modifications**
   - Conversion, compression, physical resizing, annotation, renaming, replacement, drawing migration, and cleanup can modify or remove files.
   - Some workflows provide confirmation, rollback, recovery copies, or Undo, but these safeguards cannot cover every external or concurrent change.
   - **BACK UP IMPORTANT VAULTS** before using destructive operations.

2. **Liability**
   - This plugin is provided "AS IS", without warranties or guarantees.
   - The developers are not liable for data loss, file corruption, service charges, unavailable integrations, or other damages arising from its use.
   - You are responsible for reviewing configured destinations, credentials, and provider terms.

3. **Local and remote processing**
   - Local conversion, compression, drawing persistence, and file management normally run on your device.
   - Cloud upload/download, remote OCR/LaTeX, external Draw.io embeds, Next AI Draw.io, OpenAI-compatible services, Ollama, PicGo/PicList, and other configured integrations communicate with their respective endpoints.
   - Depending on the action, transmitted data can include image bytes, diagram XML or screenshots, user prompts, extracted document or URL text, model/provider configuration, access codes, and API credentials required by the selected service.
   - Secrets are referenced through Obsidian Secret Storage where supported, but a configured service necessarily receives the credential needed to authenticate that request.
   - Remote HTTP outside loopback is restricted for sensitive Next AI requests by default; HTTPS and trusted endpoints are strongly recommended for every integration.
   - Processing large files or diagrams can consume significant memory, CPU, bandwidth, provider quota, or storage.

## Best Practices
- Create backups and test on non-critical files first.
- Review confirmation dialogs and recovery-copy paths before continuing.
- Use only endpoints you trust and understand what each enabled integration receives.
- Check provider privacy policies, retention rules, pricing, and usage limits.
- Review release notes before upgrading or enabling a new integration.

By using this plugin, you confirm that you have read, understood, and agreed to these terms.

## Third-party software

For bundled and optional third-party software, licenses, and source information, see `THIRD_PARTY_NOTICES.md` and integration-specific documentation such as `docs/pngquant.md`.

---
Last updated: 2026-08-10
