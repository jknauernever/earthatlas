// OCR a scanned PDF with macOS's built-in Vision framework (no extra install): one page of text per page, separated by form
// feeds (like pdftotext). Used by scripts/ships/air-fetch.mjs when a PDF has no text layer.
//   swift scripts/ships/ocr-pdf.swift <file.pdf>  > out.txt
import Foundation
import PDFKit
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("usage: ocr-pdf.swift <file.pdf>\n".data(using: .utf8)!)
  exit(1)
}
var out: [String] = []
for i in 0..<doc.pageCount {
  guard let page = doc.page(at: i) else { out.append(""); continue }
  let box = page.bounds(for: .mediaBox)
  let scale: CGFloat = 2.5
  let w = Int(box.width * scale), h = Int(box.height * scale)
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { out.append(""); continue }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)
  guard let img = ctx.makeImage() else { out.append(""); continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  // Top-to-bottom, then left-to-right, one observation per line.
  let obs = (req.results ?? []).sorted {
    abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.008 ? $0.boundingBox.midY > $1.boundingBox.midY : $0.boundingBox.minX < $1.boundingBox.minX
  }
  out.append(obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
}
print(out.joined(separator: "\n\u{0C}\n"))
