class Nanocoder < Formula
  desc "Local-first CLI coding agent with multi-provider support"
  homepage "https://github.com/Nano-Collective/nanocoder"
  url "https://registry.npmjs.org/@nanocollective/nanocoder/-/nanocoder-1.27.0.tgz"
  sha256 "214c6cf563616c405a7bdb22d4affc8cdf1ebb82c2c15c6089cd226e652ed2a6"
  license "MIT"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    # Test that binary exists and runs
    system "#{bin}/nanocoder", "--help"
  end
end
