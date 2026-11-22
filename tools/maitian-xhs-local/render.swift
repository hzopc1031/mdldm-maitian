import AppKit
import Foundation
import ImageIO

struct Card: Decodable {
    let title: String
    let body: String
    let label: String?
    let code: String?
    let screenshots: [Screenshot]?
}

struct Screenshot: Decodable {
    struct Crop: Decodable {
        let x: Int
        let y: Int
        let width: Int
        let height: Int
    }

    let file: String
    let crop: Crop?
    let caption: String?
}

enum RenderError: Error { case arguments, count, layout(Int), screenshot(Int), encoding }

let width = 1080
let height = 1440
let ink = NSColor(srgbRed: 0.07, green: 0.15, blue: 0.19, alpha: 1)
let background = NSColor(srgbRed: 0.96, green: 0.96, blue: 0.92, alpha: 1)
let accent = NSColor(srgbRed: 0.02, green: 0.37, blue: 0.29, alpha: 1)
let codeInk = NSColor(srgbRed: 0.90, green: 0.97, blue: 0.93, alpha: 1)

func richText(_ value: String, size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = size * 0.20
    paragraph.lineBreakMode = .byWordWrapping
    return NSAttributedString(string: value, attributes: [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: paragraph,
    ])
}

func draw(_ value: NSAttributedString, top: CGFloat, limit: CGFloat, index: Int, x: CGFloat = 100, availableWidth: CGFloat = 880) throws -> CGFloat {
    let options: NSString.DrawingOptions = [.usesLineFragmentOrigin, .usesFontLeading]
    let size = value.boundingRect(with: NSSize(width: availableWidth, height: 5000), options: options, context: nil)
    let measured = ceil(size.height) + 4
    guard value.length > 0, measured <= limit else { throw RenderError.layout(index + 1) }
    value.draw(with: NSRect(x: x, y: top - measured, width: availableWidth, height: measured), options: options, context: nil)
    return top - measured
}

func screenshotImage(_ screenshot: Screenshot, from directory: URL, index: Int) throws -> CGImage {
    let parts = screenshot.file.split(separator: "/", omittingEmptySubsequences: false)
    guard !parts.isEmpty, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
        throw RenderError.screenshot(index + 1)
    }
    let file = parts.reduce(directory) { $0.appendingPathComponent(String($1)) }
    guard file.resolvingSymlinksInPath().path == file.path,
          ["jpg", "jpeg", "png"].contains(file.pathExtension.lowercased()),
          let source = CGImageSourceCreateWithURL(file as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw RenderError.screenshot(index + 1)
    }
    guard let crop = screenshot.crop else { return image }
    guard crop.width > 0, crop.height > 0, crop.x >= 0, crop.y >= 0,
          crop.width <= image.width, crop.height <= image.height,
          crop.x <= image.width - crop.width, crop.y <= image.height - crop.height,
          let cropped = image.cropping(to: CGRect(x: crop.x, y: crop.y, width: crop.width, height: crop.height)) else {
        throw RenderError.screenshot(index + 1)
    }
    return cropped
}

func drawScreenshotCard(_ card: Card, screenshots: [Screenshot], directory: URL, index: Int) throws {
    guard screenshots.count <= 2 else { throw RenderError.screenshot(index + 1) }
    let margin: CGFloat = 72
    let availableWidth: CGFloat = 936
    let captionHeight: CGFloat = 48
    let gap: CGFloat = 20
    if let label = card.label {
        _ = try draw(richText(label, size: 29, weight: .semibold, color: accent),
            top: 1360, limit: 48, index: index, x: margin, availableWidth: availableWidth)
    }
    accent.setFill()
    NSBezierPath(rect: NSRect(x: margin, y: 1280, width: 94, height: 9)).fill()
    let titleEnd = try draw(richText(card.title, size: 69, weight: .bold, color: ink),
        top: 1240, limit: 300, index: index, x: margin, availableWidth: availableWidth)
    let bodyEnd = try draw(richText(card.body, size: 36, weight: .regular, color: ink),
        top: titleEnd - 26, limit: 225, index: index, x: margin, availableWidth: availableWidth)
    let images = try screenshots.map { try screenshotImage($0, from: directory, index: index) }
    let heights = images.map {
        availableWidth * CGFloat($0.height) / CGFloat($0.width)
    }
    var top = bodyEnd - 35
    let bottom: CGFloat = card.code == nil ? 155 : 285
    let captionSpace = CGFloat(screenshots.filter { $0.caption?.isEmpty == false }.count) * captionHeight
    let availableHeight = top - bottom - CGFloat(images.count) * gap - captionSpace
    guard availableHeight > 0 else { throw RenderError.layout(index + 1) }
    let scale = min(1, availableHeight / heights.reduce(0, +))

    for (i, image) in images.enumerated() {
        let imageHeight = heights[i] * scale
        let imageWidth = availableWidth * scale
        let rect = NSRect(x: margin, y: top - imageHeight, width: imageWidth, height: imageHeight)
        let outline = NSBezierPath(roundedRect: rect, xRadius: 16, yRadius: 16)
        NSGraphicsContext.saveGraphicsState()
        outline.addClip()
        NSImage(cgImage: image, size: .zero).draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        ink.withAlphaComponent(0.18).setStroke()
        outline.lineWidth = 2
        outline.stroke()
        top = rect.minY - gap
        if let caption = screenshots[i].caption, !caption.isEmpty {
            _ = try draw(richText(caption, size: 27, weight: .medium, color: accent),
                top: rect.minY - 12, limit: captionHeight - 12, index: index, x: margin, availableWidth: availableWidth)
            top -= captionHeight
        }
    }

    if let code = card.code {
        let rect = NSRect(x: margin, y: top - 108, width: availableWidth, height: 108)
        ink.setFill()
        NSBezierPath(roundedRect: rect, xRadius: 16, yRadius: 16).fill()
        let codeText = NSAttributedString(string: code, attributes: [
            .font: NSFont.monospacedSystemFont(ofSize: 29, weight: .medium), .foregroundColor: codeInk,
        ])
        _ = try draw(codeText, top: top - 27, limit: 72, index: index, x: margin + 26,
            availableWidth: availableWidth - 52)
    }
}

func render(_ card: Card, directory: URL, index: Int, count: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw RenderError.encoding }
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = context
    background.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    if let screenshots = card.screenshots, !screenshots.isEmpty {
        try drawScreenshotCard(card, screenshots: screenshots, directory: directory, index: index)
    } else {
        accent.setFill()
        NSBezierPath(rect: NSRect(x: 100, y: 1240, width: 100, height: 12)).fill()
        if let label = card.label {
            _ = try draw(richText(label, size: 29, weight: .semibold, color: accent), top: 1330, limit: 55, index: index)
        }
        let titleEnd = try draw(richText(card.title, size: 76, weight: .bold, color: ink), top: 1175, limit: 385, index: index)
        let bodyTop = titleEnd - 62
        let bodyEnd = try draw(richText(card.body, size: 42, weight: .regular, color: ink), top: bodyTop,
            limit: bodyTop - (card.code == nil ? 170 : 430), index: index)
        if let code = card.code {
            let boxTop = bodyEnd - 54
            ink.setFill()
            NSBezierPath(roundedRect: NSRect(x: 100, y: boxTop - 206, width: 880, height: 206), xRadius: 20, yRadius: 20).fill()
            let codeText = NSAttributedString(string: code, attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 30, weight: .medium), .foregroundColor: codeInk,
            ])
            _ = try draw(codeText, top: boxTop - 38, limit: 132, index: index, x: 134, availableWidth: 812)
        }
    }
    _ = try draw(richText("\(index + 1) / \(count)", size: 30, weight: .semibold, color: accent), top: 106, limit: 60, index: index)
    guard let data = bitmap.representation(using: .png, properties: [:]) else { throw RenderError.encoding }
    return data
}

do {
    guard CommandLine.arguments.count == 3 else { throw RenderError.arguments }
    let input = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    let cards = try JSONDecoder().decode([Card].self, from: Data(contentsOf: input))
    guard (1...9).contains(cards.count) else { throw RenderError.count }
    for (index, card) in cards.enumerated() {
        let file = output.appendingPathComponent(String(format: "%02d.png", index + 1))
        try render(card, directory: input.deletingLastPathComponent(), index: index, count: cards.count).write(to: file, options: .atomic)
    }
} catch RenderError.layout(let index) {
    FileHandle.standardError.write(Data("第 \(index) 张卡片为空或无法放进版面，请缩短文字。\n".utf8))
    exit(1)
} catch RenderError.screenshot(let index) {
    FileHandle.standardError.write(Data("第 \(index) 张卡片的截图文件、裁切范围或数量不符合要求。\n".utf8))
    exit(1)
} catch {
    FileHandle.standardError.write(Data("卡片渲染失败，请检查 cards.json 和 Swift/AppKit 环境。\n".utf8))
    exit(1)
}
