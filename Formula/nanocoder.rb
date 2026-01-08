class Nanocoder < Formula
  desc "Local-first CLI coding agent with multi-provider support"
  homepage "https://github.com/Nano-Collective/nanocoder"
  url "https://registry.npmjs.org/@nanocollective/nanocoder/-/nanocoder-1.20.4.tgz"
  sha256 "f3681d621afe9a6584158d9b8626cafe188412ea706f48692dfab43b1d06aa13"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    # Test that binary exists and runs
    system "#{bin}/nanocoder", "--help"
  end
end
