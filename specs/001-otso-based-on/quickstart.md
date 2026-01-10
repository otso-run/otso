# Quickstart: Otso iOS App

**Objective**: Validate the core user flows of the Otso iOS app

## Prerequisites

- iOS device or simulator running iOS 17+
- Xcode 15+ installed
- Test IndieAuth site (e.g., https://indieauth.com/setup)
- Test Micropub endpoint (can use https://micropub.rocks/)

## Setup

1. **Clone and build the app**
   ```bash
   cd packages/otso-apple
   open Otso/Otso.xcodeproj
   # Select target device/simulator
   # Press Cmd+R to build and run
   ```

2. **Prepare test environment**
   - Have a test website with IndieAuth configured
   - Note your authorization and token endpoints
   - Have test content ready (text, images)

## Core User Flows

### Flow 1: First Launch and IndieAuth Login

1. **Launch app**
   - App opens to welcome screen
   - Tap "Sign in with IndieAuth"

2. **Enter website URL**
   - Type your website URL (e.g., https://example.com)
   - Tap "Continue"

3. **Complete authorization**
   - Safari opens with authorization request
   - Sign in to your site if needed
   - Approve the authorization request
   - App reopens automatically

4. **Verify account setup**
   - Profile shows your website URL
   - Micropub endpoint detected
   - "Ready to post" status shown

**Expected Result**: Account is added and active, ready to compose posts

### Flow 2: Compose and Publish a Note

1. **Open composer**
   - Tap the compose button (+ icon)
   - Composer opens with keyboard visible

2. **Write a note**
   - Type a short message (under 280 characters)
   - Notice character count updates live
   - Add #hashtags - they highlight automatically

3. **Add media (optional)**
   - Tap photo icon
   - Select an image from library
   - Add alt text when prompted

4. **Publish**
   - Tap "Post" button
   - Loading indicator appears briefly
   - Success feedback shown

5. **Verify publication**
   - Post appears in timeline
   - Check your website - post is live
   - Syndication links shown if configured

**Expected Result**: Post published to your site via Micropub

### Flow 3: Save and Manage Drafts

1. **Start composing**
   - Open composer
   - Type some content
   - Swipe down to dismiss

2. **Save as draft**
   - "Save Draft" prompt appears
   - Tap "Save"
   - Draft saved confirmation

3. **Access drafts**
   - Tap drafts icon in tab bar
   - See list of saved drafts
   - Drafts show preview and timestamp

4. **Edit draft**
   - Tap a draft to open
   - Make changes
   - Auto-saves on every keystroke

5. **Publish draft**
   - Open draft
   - Tap "Post"
   - Draft moves to published

**Expected Result**: Drafts persist locally and can be edited/published later

### Flow 4: Use Share Extension

1. **Open Safari**
   - Navigate to any article
   - Tap share button

2. **Select Otso**
   - Find Otso in share sheet
   - Tap Otso icon

3. **Quick compose**
   - URL pre-filled
   - Add your commentary
   - Select post type (bookmark, reply, etc.)

4. **Share**
   - Tap "Share"
   - Returns to Safari
   - Notification confirms queued

5. **Verify in app**
   - Open Otso app
   - Check queue/drafts
   - Post appears ready to publish

**Expected Result**: Content shared from other apps queues in Otso

### Flow 5: View and Edit Posts

1. **Open posts viewer**
   - Tap "Posts" in tab bar
   - Posts load from your site

2. **View post details**
   - Tap any post
   - Full content displayed
   - Metadata shown (date, syndication)

3. **Edit existing post**
   - Tap edit button
   - Make changes
   - Tap "Update"

4. **Delete post**
   - Swipe left on post
   - Tap "Delete"
   - Confirm deletion
   - Post removed from site

**Expected Result**: Posts can be viewed, edited, and deleted

### Flow 6: Offline Mode

1. **Enable airplane mode**
   - Go to Settings > Airplane Mode
   - Return to Otso

2. **Compose while offline**
   - Create new post
   - Add media
   - Tap "Post"

3. **Check queue**
   - "Queued" badge appears
   - Post saved locally
   - Queue status shown

4. **Restore connection**
   - Disable airplane mode
   - Wait 5 seconds
   - Post automatically publishes

5. **Verify sync**
   - Queue clears
   - Post appears as published
   - Check website for post

**Expected Result**: Posts queue offline and sync when connected

## Performance Validation

### Launch Time
1. Force quit app
2. Tap app icon
3. Measure time to interactive
4. **Target**: < 300ms

### Scrolling Performance
1. Load 100+ posts
2. Scroll rapidly
3. Monitor for stutters
4. **Target**: Consistent 60fps (120fps on ProMotion)

### Draft Saving
1. Open composer
2. Type rapidly
3. Check save indicator
4. **Target**: Saves within single frame (16ms)

## Accessibility Check

1. **Enable VoiceOver**
   - Settings > Accessibility > VoiceOver
   - Navigate entire app
   - All elements properly labeled

2. **Test Dynamic Type**
   - Settings > Display > Text Size
   - Set to largest
   - All text remains readable

3. **Check Reduced Motion**
   - Settings > Accessibility > Motion
   - Enable Reduce Motion
   - Animations simplified appropriately

## Success Criteria

- [ ] All 6 core flows complete successfully
- [ ] Performance targets met
- [ ] No crashes or data loss
- [ ] Offline mode works reliably
- [ ] Accessibility features functional
- [ ] Share extension works from Safari
- [ ] Liquid glass animations smooth
- [ ] System integration feels native

## Troubleshooting

**IndieAuth fails**: Check authorization endpoint supports PKCE
**Posts don't appear**: Verify Micropub endpoint configuration
**Media upload fails**: Check media endpoint and file size limits
**Offline sync fails**: Check queue status in settings
**Share extension missing**: Rebuild with share extension target

## Next Steps

After successful quickstart:
1. Test with multiple accounts
2. Try all post types
3. Test with large media files
4. Verify memory usage stays under 150MB
5. Test background refresh