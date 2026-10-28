// Renders PDF pages to PNG and prints page text, for checking the exported preview.
// Usage: swift render_pdf.swift <in.pdf> <out-dir> [scale] [pages: 1,2,5 | all] [--text]
import AppKit
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else { print("cannot open"); exit(1) }
let outDir = args[2]
let scale = args.count > 3 ? (Double(args[3]) ?? 1.0) : 1.0
let only: Set<Int>? = (args.count > 4 && args[4] != "all") ? Set(args[4].split(separator: ",").compactMap { Int($0) }) : nil
let wantText = args.contains("--text")
print("pages \(doc.pageCount)")
for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    if wantText {
        let t = (page.string ?? "").replacingOccurrences(of: "\n", with: " ⏎ ")
        print("--- page \(i + 1): \(t)")
    }
    if let o = only, !o.contains(i + 1) { continue }
    if scale <= 0 { continue }
    let r = page.bounds(for: .mediaBox)
    let img = page.thumbnail(of: NSSize(width: r.width * scale, height: r.height * scale), for: .mediaBox)
    guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { continue }
    try? png.write(to: URL(fileURLWithPath: String(format: "%@/page-%03d.png", outDir, i + 1)))
}
