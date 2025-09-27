//
//  PlatformTypes.swift
//  Otso
//
//  Cross-platform type aliases
//

import SwiftUI
#if os(iOS)
import UIKit
public typealias PlatformImage = UIImage
#elseif os(macOS)
import AppKit
public typealias PlatformImage = NSImage
#endif