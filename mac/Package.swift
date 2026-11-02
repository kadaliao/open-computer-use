// swift-tools-version:5.9
import PackageDescription
let package = Package(
  name: "ocu-mac",
  platforms: [.macOS(.v13)],
  targets: [.executableTarget(name: "ocu-mac", path: "Sources/ocu-mac")]
)
