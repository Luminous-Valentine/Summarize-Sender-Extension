# Summarize Sender Extension

A Chrome extension that opens a new ChatGPT or Gemini chat, auto-fills the prompt using configurable templates, and optionally presses send. It supports URL or content-based submissions, character limits, truncation, and model selection safeguards for ChatGPT.

## Features
- Choose ChatGPT or Gemini as the destination and open a new chat automatically.
- Send the current page via URL mode or content mode (page text inside a code block).
- Configurable prompt templates with variables: `{url}`, `{title}`, `{content}`, `{selection}`.
- Character-limit guard with truncation or abort strategies and `[TRUNCATED]` marker when trimming.
- Optional auto-send with retry controls and model selection checks for ChatGPT.
- Options page for templates, limits, retry settings, extraction preferences, and model availability mode.

## Development
1. Load the extension in Chrome via **chrome://extensions** → **Load unpacked** and select this folder.
2. Use the toolbar action to open the popup, choose destination, mode, template, model, and auto-send.
3. Manage templates, limits, and model availability from the Options page.

Permissions are limited to `activeTab`, `scripting`, `storage`, and `tabs`, with host access only for ChatGPT (chatgpt.com) and Gemini domains.
