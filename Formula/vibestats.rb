class Vibestats < Formula
  desc "Local dashboard for Claude Code + Codex + claude.ai web chat usage"
  homepage "https://github.com/trebeljahr/vibestats"
  url "https://github.com/trebeljahr/vibestats/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "26b956cd1d407ef89434be1f3ee971f80ebfc981bfb12d74718cb2a30741322b"
  license "MIT"

  depends_on "node"
  depends_on "rsync"

  def install
    # Copy the whole tool into Homebrew's libexec; this keeps the install dir
    # self-contained and out of the user's PATH.
    libexec.install Dir["*"]
    # Symlink the CLI entry point so `vibestats` (and the `ccs` shortcut)
    # land on the user's PATH.
    bin.install_symlink libexec/"bin/cli.js" => "vibestats"
    bin.install_symlink libexec/"bin/cli.js" => "ccs"
  end

  test do
    assert_match "vibestats", shell_output("#{bin}/vibestats help")
  end
end
