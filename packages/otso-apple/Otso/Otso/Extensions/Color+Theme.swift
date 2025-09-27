//
//  Color+Theme.swift
//  Otso
//
//  Semantic colors for the app
//

import SwiftUI

extension Color {
    // MARK: - Brand Colors
    // otsoPrimary, otsoSecondary, and otsoAccent are automatically generated
    // from the Asset Catalog. No need to define them here.

    // MARK: - Semantic Colors
    struct Post {
        static let noteAccent = Color.blue
        static let articleAccent = Color.indigo
        static let photoAccent = Color.purple
        static let replyAccent = Color.teal
    }

    struct Status {
        static let success = Color.green
        static let warning = Color.orange
        static let error = Color.red
        static let info = Color.blue
        static let offline = Color.gray
    }
}