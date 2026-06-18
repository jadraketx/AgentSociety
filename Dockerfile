# syntax=docker/dockerfile:1.7
#
# Build-speed & layer-reuse notes:
#   * BuildKit cache mounts for apt / uv / npm -> no re-download on rebuild.
#   * Layer order = least-changing first: system pkgs -> node/claude -> user ->
#     python deps (manifest-only) -> project source -> extension vsix (last).
#   * agentsociety2 deps are pure-PyPI, so we install them from a throwaway stub
#     of pyproject.toml (cached across source edits), then register the real
#     source as a cheap `--no-deps` editable install.

# ================= Stage 1: Build VSCode extension as vsix =================
# engines.node: ^22.13.0 || >=24
FROM node:22 AS extension-builder

WORKDIR /app/extension

RUN npm config set registry https://registry.npmmirror.com \
    && npm install -g @vscode/vsce

# Dependency files first for better caching
COPY ./extension/package.json ./extension/package-lock.json ./
COPY ./extension/.npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Source + config (changes more often than the lockfile)
COPY ./extension/tsconfig.json ./extension/webpack.config.js ./
COPY ./extension/src/ ./src/
COPY ./extension/media/ ./media/
COPY ./extension/resources/ ./resources/
COPY ./extension/skills/ ./skills/
COPY ./extension/plugins/ ./plugins/
COPY ./extension/runtime/ ./runtime/
COPY ./extension/.vscodeignore ./
# LICENSE lives at repo root and is needed by vsce packaging
COPY LICENSE /LICENSE

RUN npm run vscode:prepublish \
    && vsce package --out /app/extension.vsix

# ================= Stage 2: Python runtime with extension =================
FROM python:3.12

# ---- System packages (Tsinghua TUNA mirror, BuildKit-cached) ----
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources; \
    else \
        sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        curl \
        sudo \
        locales \
        texlive-latex-recommended \
        texlive-latex-extra \
        texlive-fonts-recommended \
        texlive-fonts-extra \
        texlive-bibtex-extra \
        latexmk \
        biber \
        pandoc \
        libreoffice \
        poppler-utils \
        tesseract-ocr \
        unzip \
        ripgrep

# apt packages (libreoffice, etc.) may pull a newer Python into /usr/bin/,
# creating a mismatch with the base image's Python in /usr/local/bin/.
# Overwrite /usr/bin/python* symlinks so every path resolves to the same interpreter.
RUN ln -sf /usr/local/bin/python3 /usr/bin/python3 \
    && ln -sf /usr/local/bin/python3-config /usr/bin/python3-config \
    && ( [ -f /usr/local/bin/python3.12 ] && ln -sf /usr/local/bin/python3.12 /usr/bin/python3.12 || true )

WORKDIR /app

# ---- uv + Tsinghua pypi mirror ----
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
RUN ln -sf /usr/local/bin/python3 /usr/local/bin/python
RUN mkdir -p /etc/uv \
    && printf '[[index]]\nurl = "https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple/"\ndefault = true\n' > /etc/uv/uv.toml

# ---- coder user (rarely changes) ----
RUN mkdir -p /etc/sudoers.d \
    && useradd coder --create-home --shell=/bin/bash --uid=1000 --user-group \
    && echo "coder ALL=(ALL) NOPASSWD:ALL" >>/etc/sudoers.d/nopasswd

# Unicode support in terminal (C.UTF-8 ships with Debian by default)
ENV LANG=C.UTF-8
ENV LANGUAGE=C.UTF-8
ENV LC_ALL=C.UTF-8

# ---- Python dependencies: manifest-only layers (cached across source edits) ----
# Install agentsociety2's third-party deps from its pyproject via a throwaway stub
# package, then drop the stub so the editable install below is the sole record.
COPY packages/agentsociety2/pyproject.toml /tmp/as2/pyproject.toml
COPY README.md /tmp/as2/README.md
RUN --mount=type=cache,target=/root/.cache/uv \
    set -eux; \
    mkdir -p /tmp/as2/agentsociety2; \
    touch /tmp/as2/agentsociety2/__init__.py; \
    uv pip install --system /tmp/as2; \
    uv pip uninstall -y agentsociety2; \
    rm -rf /tmp/as2

# Office skills (PDF/DOCX/XLSX/PPTX) + paper-toolkit CLI: independent of project source
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system \
        pypdf \
        pdfplumber \
        reportlab \
        pytesseract \
        pdf2image \
        pandas \
        openpyxl \
        python-pptx \
        Pillow \
        python-docx \
        python-dotenv \
        "easypaper[docling,images]" \
        "paper-toolkit"

# pipx (used by some tooling)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system pipx \
    && pipx ensurepath

# ---- Project source: register editable install cheaply (deps already present) ----
COPY README.md LICENSE ./
COPY packages/ ./packages/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --no-deps -e ./packages/agentsociety2

# ---- Node.js + Claude Code / Codex (version bumps only invalidate this
#      layer; placed before vsix so it stays cached across extension changes) ----
ARG NODE_VERSION=22.14.0
RUN --mount=type=cache,target=/tmp/node-dl,sharing=locked \
    --mount=type=cache,target=/root/.npm \
    set -eux; \
    curl -fsSLO https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz; \
    tar -C /usr/local -xJf node-v${NODE_VERSION}-linux-x64.tar.xz --strip-components=1; \
    rm node-v${NODE_VERSION}-linux-x64.tar.xz; \
    npm install -g @anthropic-ai/claude-code @openai/codex; \
    npm cache clean --force

# ---- Extension vsix (changes every build -> truly last layer) ----
COPY --from=extension-builder /app/extension.vsix /app/extension.vsix

USER coder
