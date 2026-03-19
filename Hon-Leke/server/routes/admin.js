// server/routes/admin.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const store = require("../data/store");
const { requireAdmin } = require("../middleware/auth");

// ── Cloudinary setup ───────────────────────────────────────────────────────────
let uploadToCloud = null;

if (process.env.CLOUDINARY_CLOUD_NAME) {
  try {
    const cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    uploadToCloud = async (filePath, resourceType = "image") => {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: "hon-leke-blog",
        resource_type: resourceType,
        transformation:
          resourceType === "image"
            ? [
                {
                  width: 1200,
                  crop: "limit",
                  quality: "auto",
                  fetch_format: "auto",
                },
              ]
            : undefined,
      });
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
      return result.secure_url;
    };
    console.log("✅ Cloudinary configured — media stored in the cloud.");
  } catch (e) {
    console.warn(
      "⚠️  Cloudinary package not found. Run: npm install cloudinary",
    );
  }
} else {
  console.log("ℹ️  No Cloudinary config — media saved to local disk.");
}

// ── Multer ─────────────────────────────────────────────────────────────────────
const imageDir = path.join(__dirname, "..", "..", "client", "public", "image");
const videoDir = path.join(__dirname, "..", "..", "client", "public", "video");

[imageDir, videoDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (
      file.fieldname === "video" ||
      file.fieldname.startsWith("block_video_")
    ) {
      cb(null, videoDir);
    } else {
      cb(null, imageDir);
    }
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  },
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === "video" || file.fieldname.startsWith("block_video_")) {
    cb(
      null,
      /mp4|webm|mov|avi|mkv/.test(
        path.extname(file.originalname).toLowerCase(),
      ),
    );
  } else {
    cb(
      null,
      /jpeg|jpg|png|gif|webp/.test(
        path.extname(file.originalname).toLowerCase(),
      ),
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 },
}).fields([
  { name: "images", maxCount: 10 },
  { name: "image", maxCount: 1 },
  { name: "video", maxCount: 1 },
  ...Array.from({ length: 20 }, (_, i) => ({
    name: "block_image_" + i,
    maxCount: 1,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    name: "block_video_" + i,
    maxCount: 1,
  })),
]);

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── Helper Functions ───────────────────────────────────────────────────────────
async function resolveImages(req, existingImage, existingImages) {
  const files = req.files || {};
  const imageFiles = files["images"] || files["image"] || [];
  const coverIdx = parseInt(req.body.coverIndex) || 0;

  if (!imageFiles.length) {
    const imagePath = req.body.imagePath;
    if (imagePath !== undefined && imagePath !== "") {
      return { coverImage: imagePath, allImages: [imagePath] };
    }
    return {
      coverImage: existingImage || "",
      allImages: existingImages || (existingImage ? [existingImage] : []),
    };
  }

  const resolvedPaths = await Promise.all(
    imageFiles.map(async (file) => {
      if (uploadToCloud) {
        try {
          return await uploadToCloud(file.path, "image");
        } catch (e) {
          console.error("Cloudinary image upload failed:", e.message);
          return "image/" + file.filename;
        }
      }
      return "image/" + file.filename;
    }),
  );

  const safeIdx = Math.min(coverIdx, resolvedPaths.length - 1);
  const coverImage = resolvedPaths[safeIdx];
  return { coverImage, allImages: resolvedPaths };
}

async function resolveVideo(req, existingVideoSrc) {
  const files = req.files || {};
  const videoFile = (files["video"] || [])[0];
  const videoType = req.body.videoType || "none";
  const videoUrl = req.body.videoUrl || "";
  const hasVideo = req.body.hasVideo === "true" || req.body.hasVideo === true;

  if (!hasVideo)
    return { hasVideo: false, videoType: "none", videoSrc: "", videoUrl: "" };

  if (videoType === "youtube" && videoUrl) {
    return { hasVideo: true, videoType: "youtube", videoSrc: "", videoUrl };
  }

  if (videoFile) {
    let src;
    if (uploadToCloud) {
      try {
        src = await uploadToCloud(videoFile.path, "video");
      } catch (e) {
        console.error("Cloudinary video upload failed:", e.message);
        src = "video/" + videoFile.filename;
      }
    } else {
      src = "video/" + videoFile.filename;
    }
    return { hasVideo: true, videoType: "upload", videoSrc: src, videoUrl: "" };
  }

  if (existingVideoSrc) {
    return {
      hasVideo: true,
      videoType: req.body.videoType || "upload",
      videoSrc: existingVideoSrc,
      videoUrl,
    };
  }

  return { hasVideo: false, videoType: "none", videoSrc: "", videoUrl: "" };
}

async function resolveBlocks(req, rawBlocks) {
  if (!rawBlocks || !rawBlocks.length) return [];
  const files = req.files || {};

  let imgIdx = 0;
  let vidIdx = 0;

  return Promise.all(
    rawBlocks.map(async (b) => {
      const block = Object.assign({}, b);
      delete block._fileKey;

      if (block.type === "image") {
        const key = "block_image_" + imgIdx++;
        const file = (files[key] || [])[0];
        if (file) {
          if (uploadToCloud) {
            try {
              block.image = await uploadToCloud(file.path, "image");
            } catch (e) {
              block.image = "image/" + file.filename;
            }
          } else {
            block.image = "image/" + file.filename;
          }
        }
        return block;
      }

      if (block.type === "video" && block.videoType === "upload") {
        const key = "block_video_" + vidIdx++;
        const file = (files[key] || [])[0];
        if (file) {
          if (uploadToCloud) {
            try {
              block.videoSrc = await uploadToCloud(file.path, "video");
            } catch (e) {
              block.videoSrc = "video/" + file.filename;
            }
          } else {
            block.videoSrc = "video/" + file.filename;
          }
        }
        return block;
      }

      if (block.type === "video" && block.videoType === "youtube") {
        return block;
      }

      return block;
    }),
  );
}

// ── Auth ───────────────────────────────────────────────────────────────────────
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  const admin = store.adminUser;
  if (username === admin.username && password === admin.password) {
    req.session.admin = true;
    req.session.adminName = admin.name;
    return res.json({
      success: true,
      message: "Login successful",
      name: admin.name,
    });
  }
  res.status(401).json({ success: false, message: "Invalid credentials." });
});

router.post("/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: "Logged out." });
});

router.get("/me", requireAdmin, (req, res) => {
  res.json({ success: true, name: req.session.adminName || "Admin" });
});

// ── Stats ──────────────────────────────────────────────────────────────────────
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, stats: await store.getStats() });
  } catch (err) {
    console.error("GET /admin/stats error:", err);
    res.status(500).json({ success: false, message: "Failed to load stats." });
  }
});

// ── Posts ──────────────────────────────────────────────────────────────────────
router.get("/posts", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, posts: await store.getAllPosts() });
  } catch (err) {
    console.error("GET /admin/posts error:", err);
    res.status(500).json({ success: false, message: "Failed to load posts." });
  }
});

// CREATE POST
router.post("/posts", requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);
    let tags = [];
    try {
      tags = JSON.parse(req.body.tags || "[]");
    } catch (e) {
      tags = [];
    }

    const { title, excerpt, content, category, date, featured } = req.body;
    if (!title || !excerpt || !category)
      return res.status(400).json({
        success: false,
        message: "Title, excerpt and category are required.",
      });

    const { coverImage, allImages } = await resolveImages(req, "", []);

    let rawBlocks = [];
    try {
      rawBlocks = JSON.parse(req.body.blocks || "[]");
    } catch (e) {}
    const resolvedBlocks = await resolveBlocks(req, rawBlocks);

    const videoBlock = resolvedBlocks.find((b) => b.type === "video");
    const videoData = videoBlock
      ? {
          hasVideo: true,
          videoType: videoBlock.videoType,
          videoSrc: videoBlock.videoSrc || "",
          videoUrl: videoBlock.videoUrl || "",
        }
      : await resolveVideo(req, "");

    const post = await store.createPost({
      title,
      excerpt,
      content: content || "",
      category,
      date,
      featured: featured === "true" || featured === true,
      image: coverImage,
      images: allImages,
      blocks: resolvedBlocks, 
      tags,
      ...videoData,
    });

    res.json({
      success: true,
      message: "Post created successfully!",
      post,
      postId: post.id,
    });
  } catch (err) {
    console.error("POST /admin/posts error:", err);
    res.status(500).json({
      success: false,
      message: "Server error creating post: " + err.message,
    });
  }
});

// UPDATE POST
router.put("/posts/:id", requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);
    let tags = [];
    try {
      tags = JSON.parse(req.body.tags || "[]");
    } catch (e) {
      tags = [];
    }

    const id = req.params.id;
    const existing = await store.getPostById(id);
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Post not found." });

    const { title, excerpt, content, category, date, featured } = req.body;

    const { coverImage, allImages } = await resolveImages(
      req,
      existing.image,
      existing.images,
    );

    let rawBlocks = [];
    try {
      rawBlocks = JSON.parse(req.body.blocks || "[]");
    } catch (e) {}
    const resolvedBlocks = await resolveBlocks(req, rawBlocks);

    const videoBlock = resolvedBlocks.find((b) => b.type === "video");
    const videoData = videoBlock
      ? {
          hasVideo: true,
          videoType: videoBlock.videoType,
          videoSrc: videoBlock.videoSrc || "",
          videoUrl: videoBlock.videoUrl || "",
        }
      : await resolveVideo(req, existing.videoSrc);

    const post = await store.updatePost(id, {
      title,
      excerpt,
      content: content || "",
      category,
      date,
      featured: featured === "true" || featured === true,
      image: coverImage,
      images: allImages,
      blocks: resolvedBlocks, 
      tags,
      ...videoData,
    });

    res.json({ success: true, message: "Post updated successfully!", post });
  } catch (err) {
    console.error("PUT /admin/posts/:id error:", err);
    res.status(500).json({
      success: false,
      message: "Server error updating post: " + err.message,
    });
  }
});

// DELETE POST
router.delete("/posts/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await store.deletePost(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, message: "Post not found." });
    res.json({ success: true, message: "Post deleted." });
  } catch (err) {
    console.error("DELETE /admin/posts/:id error:", err);
    res.status(500).json({ success: false, message: "Failed to delete post." });
  }
});

// TOGGLE FEATURED
router.patch("/posts/:id/featured", requireAdmin, async (req, res) => {
  try {
    const post = await store.toggleFeatured(req.params.id);
    if (!post)
      return res
        .status(404)
        .json({ success: false, message: "Post not found." });
    res.json({
      success: true,
      message: post.featured ? "Added to slider." : "Removed from slider.",
      featured: post.featured,
    });
  } catch (err) {
    console.error("PATCH /admin/posts/:id/featured error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to toggle featured." });
  }
});

// DELETE TAG from all posts
router.delete("/tags/:tag", requireAdmin, async (req, res) => {
  try {
    const tag = decodeURIComponent(req.params.tag).trim();
    if (!tag)
      return res
        .status(400)
        .json({ success: false, message: "Tag is required." });

    const result = await require("../models/post").updateMany(
      { tags: tag },
      { $pull: { tags: tag } },
    );

    res.json({
      success: true,
      updatedPosts: result.modifiedCount,
      message: `Tag "${tag}" removed from ${result.modifiedCount} post(s).`,
    });
  } catch (err) {
    console.error("DELETE /api/admin/tags error:", err);
    res.status(500).json({ success: false, message: "Failed to delete tag." });
  }
});

// ── Comments ───────────────────────────────────────────────────────────────────
router.get("/comments", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, comments: await store.getAllComments() });
  } catch (err) {
    console.error("GET /admin/comments error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load comments." });
  }
});

router.delete("/comments/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteComment(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, message: "Comment not found." });
    res.json({ success: true, message: "Comment deleted." });
  } catch (err) {
    console.error("DELETE /admin/comments/:id error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete comment." });
  }
});

router.patch("/comments/:id/reply", requireAdmin, async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply || !reply.trim())
      return res
        .status(400)
        .json({ success: false, message: "Reply text is required." });

    const dateStr = new Date().toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const Comment = require("../models/Comment");
    const doc = await Comment.findByIdAndUpdate(
      req.params.id,
      { reply: reply.trim(), repliedAt: dateStr, repliedByAdmin: true },
      { new: true },
    ).lean();

    if (!doc)
      return res
        .status(404)
        .json({ success: false, message: "Comment not found." });

    const plain = JSON.parse(JSON.stringify(doc));
    plain.id = doc._id.toString();

    res.json({ success: true, message: "Reply saved.", comment: plain });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/comments/:id/reply/delete", requireAdmin, async (req, res) => {
  try {
    const Comment = require("../models/Comment");
    const doc = await Comment.findByIdAndUpdate(
      req.params.id,
      { reply: "", repliedAt: "", repliedByAdmin: false },
      { new: true },
    ).lean();

    if (!doc)
      return res
        .status(404)
        .json({ success: false, message: "Comment not found." });

    res.json({ success: true, message: "Reply removed." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Messages ───────────────────────────────────────────────────────────────────
router.get("/messages", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, messages: await store.getAllMessages() });
  } catch (err) {
    console.error("GET /admin/messages error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load messages." });
  }
});

router.patch("/messages/:id/read", requireAdmin, async (req, res) => {
  try {
    const msg = await store.markMessageRead(req.params.id);
    if (!msg)
      return res
        .status(404)
        .json({ success: false, message: "Message not found." });
    res.json({ success: true, message: "Marked as read." });
  } catch (err) {
    console.error("PATCH /admin/messages/:id/read error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to mark message as read." });
  }
});

router.delete("/messages/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteMessage(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, message: "Message not found." });
    res.json({ success: true, message: "Message deleted." });
  } catch (err) {
    console.error("DELETE /admin/messages/:id error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete message." });
  }
});

// ── Subscribers ────────────────────────────────────────────────────────────────
router.get("/subscribers", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, subscribers: await store.getAllSubscribers() });
  } catch (err) {
    console.error("GET /admin/subscribers error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load subscribers." });
  }
});

router.delete("/subscribers/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await store.deleteSubscriber(req.params.id);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, message: "Subscriber not found." });
    res.json({ success: true, message: "Subscriber removed." });
  } catch (err) {
    console.error("DELETE /admin/subscribers/:id error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to remove subscriber." });
  }
});

// ── Settings ───────────────────────────────────────────────────────────────────
router.get("/settings", requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, settings: await store.getSettings() });
  } catch (err) {
    console.error("GET /admin/settings error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load settings." });
  }
});

router.put("/settings", requireAdmin, async (req, res) => {
  try {
    const settings = await store.updateSettings(req.body);
    res.json({ success: true, message: "Settings updated.", settings });
  } catch (err) {
    console.error("PUT /admin/settings error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update settings." });
  }
});

// ── About Page ─────────────────────────────────────────────────────────────────
const aboutUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
}).fields([
  { name: "lekeImage", maxCount: 1 },
  { name: "spouseImage", maxCount: 1 },
  ...Array.from({ length: 20 }, (_, i) => ({
    name: "teamImage_" + i,
    maxCount: 1,
  })),
]);

function runAboutUpload(req, res) {
  return new Promise((resolve, reject) => {
    aboutUpload(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

router.post("/about", requireAdmin, async (req, res) => {
  try {
    await runAboutUpload(req, res);
    const files = req.files || {};
    const aboutData = JSON.parse(req.body.aboutData || "{}");

    if (files["lekeImage"] && files["lekeImage"][0]) {
      const f = files["lekeImage"][0];
      aboutData.lekeImage = uploadToCloud
        ? await uploadToCloud(f.path, "image").catch(
            () => "image/" + f.filename,
          )
        : "image/" + f.filename;
    }

    if (files["spouseImage"] && files["spouseImage"][0]) {
      const f = files["spouseImage"][0];
      aboutData.spouseImage = uploadToCloud
        ? await uploadToCloud(f.path, "image").catch(
            () => "image/" + f.filename,
          )
        : "image/" + f.filename;
    }

    if (aboutData.team) {
      for (let i = 0; i < aboutData.team.length; i++) {
        const key = "teamImage_" + i;
        if (files[key] && files[key][0]) {
          const f = files[key][0];
          aboutData.team[i].image = uploadToCloud
            ? await uploadToCloud(f.path, "image").catch(
                () => "image/" + f.filename,
              )
            : "image/" + f.filename;
        }
      }
    }

    const current = await store.getSettings();
    const settings = await store.updateSettings({
      ...current,
      about: aboutData,
    });
    res.json({ success: true, message: "About page updated.", settings });
  } catch (err) {
    console.error("POST /admin/about error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to save about page: " + err.message,
    });
  }
});

module.exports = router;
