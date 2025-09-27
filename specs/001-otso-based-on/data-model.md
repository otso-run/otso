# Data Model: Otso iOS App

**Date**: 2025-09-27
**Storage**: SwiftData

## Core Entities

### Account
**Purpose**: Represents an IndieAuth-enabled account
```swift
@Model
class Account {
    var id: UUID
    var me: URL // IndieAuth identity URL
    var displayName: String
    var avatarURL: URL?
    var endpoints: Endpoints
    var accessToken: String // Store in Keychain
    var refreshToken: String? // Store in Keychain
    var tokenExpiry: Date?
    var createdAt: Date
    var lastUsedAt: Date
    var isActive: Bool

    // Relationships
    var posts: [Post]
    var drafts: [Draft]
}
```

### Endpoints
**Purpose**: Micropub and IndieAuth endpoint configuration
```swift
@Model
class Endpoints {
    var authorization: URL
    var token: URL
    var micropub: URL
    var microsub: URL?
    var mediaEndpoint: URL?
    var webmention: URL?
}
```

### Post
**Purpose**: Published content from the user's site
```swift
@Model
class Post {
    var id: UUID
    var url: URL // Canonical URL on the user's site
    var type: PostType // note, article, photo, reply, repost, like, bookmark
    var content: String // HTML or Markdown
    var plainTextContent: String
    var name: String? // Title for articles
    var summary: String?
    var published: Date
    var updated: Date?
    var visibility: Visibility // public, unlisted, private
    var tags: [String]
    var syndication: [URL] // Syndication targets

    // Relationships
    var account: Account
    var media: [MediaAsset]
    var inReplyTo: URL?
    var likeOf: URL?
    var repostOf: URL?
    var bookmarkOf: URL?
}
```

### Draft
**Purpose**: Unsaved or queued posts
```swift
@Model
class Draft {
    var id: UUID
    var content: String
    var type: PostType
    var name: String? // Title
    var tags: [String]
    var visibility: Visibility
    var createdAt: Date
    var modifiedAt: Date
    var scheduledFor: Date?
    var inReplyTo: URL?

    // Relationships
    var account: Account
    var media: [MediaAsset]
    var queuedOperation: QueuedOperation?
}
```

### MediaAsset
**Purpose**: Images, videos, and other media attachments
```swift
@Model
class MediaAsset {
    var id: UUID
    var localURL: URL // Local file storage
    var remoteURL: URL? // After upload
    var mimeType: String
    var altText: String?
    var width: Int?
    var height: Int?
    var fileSize: Int
    var uploadedAt: Date?

    // Relationships
    var posts: [Post]
    var drafts: [Draft]
}
```

### QueuedOperation
**Purpose**: Offline queue for pending operations
```swift
@Model
class QueuedOperation {
    var id: UUID
    var type: OperationType // create, update, delete, upload
    var payload: Data // JSON encoded operation
    var retryCount: Int
    var createdAt: Date
    var nextRetryAt: Date?
    var error: String?

    // Relationships
    var draft: Draft?
    var account: Account
}
```

### ShareItem
**Purpose**: Content shared via share extension
```swift
@Model
class ShareItem {
    var id: UUID
    var url: URL?
    var title: String?
    var excerpt: String?
    var imageURL: URL?
    var sharedAt: Date
    var convertedToDraft: Bool

    // Relationships
    var draft: Draft?
}
```

## Enumerations

### PostType
```swift
enum PostType: String, CaseIterable, Codable {
    case note = "note"
    case article = "article"
    case photo = "photo"
    case reply = "reply"
    case repost = "repost"
    case like = "like"
    case bookmark = "bookmark"
    case checkin = "checkin"
    case rsvp = "rsvp"
}
```

### Visibility
```swift
enum Visibility: String, CaseIterable, Codable {
    case `public` = "public"
    case unlisted = "unlisted"
    case `private` = "private"
}
```

### OperationType
```swift
enum OperationType: String, Codable {
    case createPost = "create_post"
    case updatePost = "update_post"
    case deletePost = "delete_post"
    case uploadMedia = "upload_media"
}
```

## Validation Rules

### Account
- `me` must be a valid HTTPS URL
- `displayName` required, max 100 characters
- Only one account can have `isActive = true`

### Post
- `content` required for all types except photo
- `name` required for article type
- `published` cannot be in the future
- `media` required for photo type

### Draft
- Auto-save triggered on any content change
- `modifiedAt` updated on every save
- `scheduledFor` must be in the future if set

### MediaAsset
- Supported types: image/jpeg, image/png, image/gif, image/webp, video/mp4
- Max file size: 50MB for images, 200MB for videos
- `altText` required for accessibility

### QueuedOperation
- Max retry count: 5
- Exponential backoff: 1s, 2s, 4s, 8s, 16s
- Operations older than 7 days are archived

## State Transitions

### Draft → Post
1. User taps publish
2. Draft validated
3. QueuedOperation created if offline
4. Micropub request sent
5. Post created with returned URL
6. Draft marked as published or deleted

### ShareItem → Draft
1. Content received via share extension
2. ShareItem created
3. User edits in composer
4. Draft created with ShareItem reference
5. ShareItem marked as converted

### QueuedOperation States
1. **Pending**: Initial state
2. **Processing**: Currently being sent
3. **Success**: Operation completed
4. **Failed**: Permanent failure after max retries
5. **Cancelled**: User cancelled operation

## Indexes

- Account.me (unique)
- Account.isActive
- Post.published (descending)
- Post.type
- Draft.modifiedAt (descending)
- QueuedOperation.nextRetryAt
- MediaAsset.remoteURL

## Migration Notes

SwiftData handles schema migrations automatically through versioned schemas. Initial schema version is 1.0.0.