//
//  PreviewData.swift
//  Otso
//
//  Mock data for SwiftUI previews
//

import Foundation
import SwiftUI

struct PreviewData {
    // MARK: - Mock Accounts
    static let mockAccount = MockAccount(
        id: UUID(),
        me: URL(string: "https://example.com")!,
        displayName: "Jane Doe",
        avatarURL: URL(string: "https://example.com/avatar.jpg"),
        isActive: true
    )

    static let mockAccounts = [
        mockAccount,
        MockAccount(
            id: UUID(),
            me: URL(string: "https://blog.example.org")!,
            displayName: "Tech Blog",
            avatarURL: nil,
            isActive: false
        )
    ]

    // MARK: - Mock Posts
    static let mockPosts = [
        MockPost(
            id: UUID(),
            type: .note,
            content: "Just shipped a new feature! 🚀 Really excited about the liquid glass UI components.",
            plainTextContent: "Just shipped a new feature! Really excited about the liquid glass UI components.",
            published: Date().addingTimeInterval(-3600),
            visibility: .public,
            tags: ["development", "design"],
            media: []
        ),
        MockPost(
            id: UUID(),
            type: .article,
            content: "# IndieWeb and the Future of Personal Publishing\n\nThe IndieWeb movement represents a fundamental shift in how we think about online identity...",
            plainTextContent: "IndieWeb and the Future of Personal Publishing. The IndieWeb movement represents a fundamental shift...",
            name: "IndieWeb and the Future of Personal Publishing",
            published: Date().addingTimeInterval(-86400),
            visibility: .public,
            tags: ["indieweb", "publishing", "web"],
            media: []
        ),
        MockPost(
            id: UUID(),
            type: .photo,
            content: "Beautiful sunset from my hike today",
            plainTextContent: "Beautiful sunset from my hike today",
            published: Date().addingTimeInterval(-172800),
            visibility: .public,
            tags: ["photography", "nature"],
            media: [MockMediaAsset(
                id: UUID(),
                mimeType: "image/jpeg",
                altText: "Sunset over mountain peaks with golden clouds",
                width: 1920,
                height: 1080
            )]
        ),
        MockPost(
            id: UUID(),
            type: .reply,
            content: "Great point about data ownership! This is exactly why I'm building tools for the IndieWeb.",
            plainTextContent: "Great point about data ownership! This is exactly why I'm building tools for the IndieWeb.",
            published: Date().addingTimeInterval(-259200),
            visibility: .public,
            tags: [],
            media: [],
            inReplyTo: URL(string: "https://social.example.com/posts/123")
        )
    ]

    // MARK: - Mock Drafts
    static let mockDrafts = [
        MockDraft(
            id: UUID(),
            content: "Working on a new blog post about SwiftUI and liquid animations...",
            type: .article,
            name: "SwiftUI Liquid Animations Guide",
            tags: ["swift", "ios", "animation"],
            visibility: .public,
            createdAt: Date().addingTimeInterval(-7200),
            modifiedAt: Date().addingTimeInterval(-1800)
        ),
        MockDraft(
            id: UUID(),
            content: "Quick thought: What if we could make UI components that feel like water?",
            type: .note,
            tags: ["ui", "design"],
            visibility: .public,
            createdAt: Date().addingTimeInterval(-14400),
            modifiedAt: Date().addingTimeInterval(-14400)
        ),
        MockDraft(
            id: UUID(),
            content: "Reply draft to interesting discussion",
            type: .reply,
            tags: [],
            visibility: .public,
            createdAt: Date().addingTimeInterval(-86400),
            modifiedAt: Date().addingTimeInterval(-86400),
            inReplyTo: URL(string: "https://example.com/posts/456")
        )
    ]

    // MARK: - Mock Share Items
    static let mockShareItem = MockShareItem(
        id: UUID(),
        url: URL(string: "https://interesting-article.com/post"),
        title: "The Rise of Local-First Software",
        excerpt: "An exploration of how local-first architecture is changing the way we build applications...",
        sharedAt: Date()
    )
}

// MARK: - Mock Data Models
struct MockAccount {
    let id: UUID
    let me: URL
    let displayName: String
    let avatarURL: URL?
    let isActive: Bool
}

struct MockPost {
    let id: UUID
    let type: PostType
    let content: String
    let plainTextContent: String
    let name: String?
    let published: Date
    let visibility: Visibility
    let tags: [String]
    let media: [MockMediaAsset]
    let inReplyTo: URL?

    init(id: UUID = UUID(),
         type: PostType,
         content: String,
         plainTextContent: String,
         name: String? = nil,
         published: Date = Date(),
         visibility: Visibility = .public,
         tags: [String] = [],
         media: [MockMediaAsset] = [],
         inReplyTo: URL? = nil) {
        self.id = id
        self.type = type
        self.content = content
        self.plainTextContent = plainTextContent
        self.name = name
        self.published = published
        self.visibility = visibility
        self.tags = tags
        self.media = media
        self.inReplyTo = inReplyTo
    }
}

struct MockDraft {
    let id: UUID
    let content: String
    let type: PostType
    let name: String?
    let tags: [String]
    let visibility: Visibility
    let createdAt: Date
    let modifiedAt: Date
    let inReplyTo: URL?

    init(id: UUID = UUID(),
         content: String,
         type: PostType,
         name: String? = nil,
         tags: [String] = [],
         visibility: Visibility = .public,
         createdAt: Date = Date(),
         modifiedAt: Date = Date(),
         inReplyTo: URL? = nil) {
        self.id = id
        self.content = content
        self.type = type
        self.name = name
        self.tags = tags
        self.visibility = visibility
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
        self.inReplyTo = inReplyTo
    }
}

struct MockMediaAsset {
    let id: UUID
    let mimeType: String
    let altText: String?
    let width: Int?
    let height: Int?
}

struct MockShareItem {
    let id: UUID
    let url: URL?
    let title: String?
    let excerpt: String?
    let sharedAt: Date
}

// MARK: - Enums for Mock Data
enum PostType: String, CaseIterable {
    case note = "note"
    case article = "article"
    case photo = "photo"
    case reply = "reply"
    case repost = "repost"
    case like = "like"
    case bookmark = "bookmark"

    var icon: String {
        switch self {
        case .note: return "note.text"
        case .article: return "doc.text"
        case .photo: return "photo"
        case .reply: return "arrowshape.turn.up.left"
        case .repost: return "arrow.2.squarepath"
        case .like: return "heart"
        case .bookmark: return "bookmark"
        }
    }

    var displayName: String {
        switch self {
        case .note: return "Note"
        case .article: return "Article"
        case .photo: return "Photo"
        case .reply: return "Reply"
        case .repost: return "Repost"
        case .like: return "Like"
        case .bookmark: return "Bookmark"
        }
    }
}

enum Visibility: String, CaseIterable {
    case `public` = "public"
    case unlisted = "unlisted"
    case `private` = "private"

    var icon: String {
        switch self {
        case .public: return "globe"
        case .unlisted: return "link"
        case .private: return "lock"
        }
    }

    var displayName: String {
        switch self {
        case .public: return "Public"
        case .unlisted: return "Unlisted"
        case .private: return "Private"
        }
    }

    var description: String {
        switch self {
        case .public: return "Visible to everyone"
        case .unlisted: return "Only accessible via direct link"
        case .private: return "Only visible to you"
        }
    }
}