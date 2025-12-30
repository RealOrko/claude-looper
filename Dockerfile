FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Set locale and terminal
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV TERM=xterm-256color

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    gnupg \
    wget \
    build-essential \
    gcc \
    g++ \
    gdb \
    make \
    cmake \
    software-properties-common \
    locales \
    sudo \
    direnv \
    && rm -rf /var/lib/apt/lists/*

# Install LLVM 19 toolchain for kernel development with ThinLTO
RUN wget -qO- https://apt.llvm.org/llvm-snapshot.gpg.key | tee /etc/apt/trusted.gpg.d/apt.llvm.org.asc \
    && echo "deb http://apt.llvm.org/noble/ llvm-toolchain-noble-19 main" >> /etc/apt/sources.list.d/llvm.list \
    && apt-get update && apt-get install -y \
    clang-19 \
    lld-19 \
    llvm-19 \
    llvm-19-dev \
    llvm-19-tools \
    libclang-19-dev \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/clang clang /usr/bin/clang-19 100 \
    && update-alternatives --install /usr/bin/clang++ clang++ /usr/bin/clang++-19 100 \
    && update-alternatives --install /usr/bin/ld.lld ld.lld /usr/bin/ld.lld-19 100 \
    && update-alternatives --install /usr/bin/llvm-ar llvm-ar /usr/bin/llvm-ar-19 100 \
    && update-alternatives --install /usr/bin/llvm-nm llvm-nm /usr/bin/llvm-nm-19 100 \
    && update-alternatives --install /usr/bin/llvm-objcopy llvm-objcopy /usr/bin/llvm-objcopy-19 100 \
    && update-alternatives --install /usr/bin/llvm-objdump llvm-objdump /usr/bin/llvm-objdump-19 100 \
    && update-alternatives --install /usr/bin/llvm-strip llvm-strip /usr/bin/llvm-strip-19 100 \
    && update-alternatives --install /usr/bin/llvm-readelf llvm-readelf /usr/bin/llvm-readelf-19 100

# Install kernel build dependencies
RUN apt-get update && apt-get install -y \
    flex \
    bison \
    libelf-dev \
    libssl-dev \
    libncurses-dev \
    bc \
    cpio \
    kmod \
    rsync \
    dwarves \
    zstd \
    libzstd-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python latest (via deadsnakes PPA for latest version)
RUN add-apt-repository ppa:deadsnakes/ppa -y \
    && apt-get update \
    && apt-get install -y \
    python3.13 \
    python3.13-venv \
    python3.13-dev \
    python3-pip \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.13 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.13 1 \
    && rm -rf /var/lib/apt/lists/*

# Install Go latest (1.24.x)
ENV GO_VERSION=1.24.10
RUN wget -q https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz \
    && rm go${GO_VERSION}.linux-amd64.tar.gz

# Install Node.js 22.x LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Install claude-looper dependencies in a separate location
# Source code will be mounted at /opt/claude-looper at runtime
WORKDIR /opt/claude-looper-deps
COPY package.json package-lock.json ./
RUN npm install

# Set NODE_PATH so node finds deps even when source is mounted over /opt/claude-looper
ENV NODE_PATH=/opt/claude-looper-deps/node_modules

# Create mount point for source code
RUN mkdir -p /opt/claude-looper

# Create wrapper script that runs from mounted source
RUN echo '#!/bin/bash\ncd /opt/claude-looper && exec node cli.js "$@"' > /usr/local/bin/claude-looper \
    && chmod +x /usr/local/bin/claude-looper

# Create claude user with sudo access (UID 1000 to match typical host user)
# First remove any existing user with UID 1000, then create claude user
RUN existing_user=$(getent passwd 1000 | cut -d: -f1) \
    && if [ -n "$existing_user" ]; then userdel -r "$existing_user" 2>/dev/null || true; fi \
    && useradd -m -s /bin/bash -u 1000 claude \
    && echo "claude ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set up environment variables for claude user
ENV HOME=/home/claude
ENV USER=claude

# Go environment
ENV GOROOT=/usr/local/go
ENV GOPATH=/home/claude/go
ENV GOBIN=/home/claude/go/bin

# Python environment
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_USER=1
ENV PYTHONUSERBASE=/home/claude/.local

# Node.js environment
ENV NPM_CONFIG_PREFIX=/home/claude/.npm-global

# Combined PATH with all tools
ENV PATH=/home/claude/.local/bin:/home/claude/.npm-global/bin:/home/claude/go/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Switch to claude user
USER claude
WORKDIR /home/claude

# Set up directories and shell configuration
RUN mkdir -p \
    /home/claude/workspace \
    /home/claude/go/bin \
    /home/claude/go/pkg \
    /home/claude/go/src \
    /home/claude/.local/bin \
    /home/claude/.npm-global \
    /home/claude/.config

# Create .bashrc with all environment variables
RUN echo '# Environment variables' >> /home/claude/.bashrc \
    && echo 'export LANG=C.UTF-8' >> /home/claude/.bashrc \
    && echo 'export LC_ALL=C.UTF-8' >> /home/claude/.bashrc \
    && echo 'export TERM=xterm-256color' >> /home/claude/.bashrc \
    && echo '' >> /home/claude/.bashrc \
    && echo '# Go' >> /home/claude/.bashrc \
    && echo 'export GOROOT=/usr/local/go' >> /home/claude/.bashrc \
    && echo 'export GOPATH=$HOME/go' >> /home/claude/.bashrc \
    && echo 'export GOBIN=$HOME/go/bin' >> /home/claude/.bashrc \
    && echo '' >> /home/claude/.bashrc \
    && echo '# Python' >> /home/claude/.bashrc \
    && echo 'export PYTHONDONTWRITEBYTECODE=1' >> /home/claude/.bashrc \
    && echo 'export PYTHONUNBUFFERED=1' >> /home/claude/.bashrc \
    && echo 'export PIP_USER=1' >> /home/claude/.bashrc \
    && echo 'export PYTHONUSERBASE=$HOME/.local' >> /home/claude/.bashrc \
    && echo '' >> /home/claude/.bashrc \
    && echo '# Node.js' >> /home/claude/.bashrc \
    && echo 'export NPM_CONFIG_PREFIX=$HOME/.npm-global' >> /home/claude/.bashrc \
    && echo '' >> /home/claude/.bashrc \
    && echo '# PATH' >> /home/claude/.bashrc \
    && echo 'export PATH=$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/go/bin:/usr/local/go/bin:$PATH' >> /home/claude/.bashrc \
    && echo '' >> /home/claude/.bashrc \
    && echo '# Aliases' >> /home/claude/.bashrc \
    && echo 'alias ll="ls -la"' >> /home/claude/.bashrc \
    && echo 'alias py="python"' >> /home/claude/.bashrc \
    && echo '' >> /home/claude/.bashrc \
    && echo '# direnv' >> /home/claude/.bashrc \
    && echo 'eval "$(direnv hook bash)"' >> /home/claude/.bashrc

# Also create .profile for login shells
RUN cp /home/claude/.bashrc /home/claude/.profile

WORKDIR /home/claude/workspace

# Default command with dangerously-skip-permissions flag
CMD ["claude", "--dangerously-skip-permissions"]
