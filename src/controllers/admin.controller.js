import fs from "fs/promises";
import cloudinary from "../config/cloudinary.js";
import { Product } from "../models/product.model.js";
import { Order } from "../models/order.model.js";
import { User } from "../models/user.model.js";

export async function createProduct(req, res) {
  try {
    const { name, description, price, stock, category } = req.body;

    if (!name || !description || category === undefined) {
      return res.status(400).json({ message: "Name, description, and category are required" });
    }

    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock);

    if (isNaN(parsedPrice) || parsedPrice < 0 || isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ message: "Price and stock must be valid non-negative numbers" });
    }

    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ message: "At least one image is required" });
    }

    if (req.files.length > 3) {
      return res.status(400).json({ message: "Maximum 3 images allowed" });
    }

    //create the file path i cloudinary
    const uploadPromises = req.files.map((file) => {
      return cloudinary.uploader.upload(file.path, {
        folder: "products",
      });
    });

    let uploadResults = [];
    try {
      // upload the images
      uploadResults = await Promise.all(uploadPromises);
      // secure_url
      const imageUrls = uploadResults.map((result) => result.secure_url);
  
      const product = await Product.create({
        name,
        description,
        price: parsedPrice,
        stock: parsedStock,
        category,
        images: imageUrls,
      });
  
      res.status(201).json(product);
    } catch (error) {
      if (uploadResults && uploadResults.length > 0) {
        const deletePromises = uploadResults.map((result) =>
          cloudinary.uploader.destroy(result.public_id)
        );
        await Promise.all(deletePromises.filter(Boolean));
      }
      throw error;
    }
  } catch (error) {
    console.error("Error creating product", error);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (req.files) {
      await Promise.all(
        req.files.map((file) =>
          fs.unlink(file.path).catch((err) => console.error("Failed to delete temp file:", err))
        )
      );
    }
  }
}

export async function getAllProducts(_, res) {
  try {
    // -1 means in desc order: most recent products first
    const products = await Product.find().sort({ createdAt: -1 });
    res.status(200).json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { name, description, price, stock, category } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (name) product.name = name;
    if (description) product.description = description;
    if (price !== undefined) {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ message: "Price must be a valid non-negative number" });
      product.price = parsedPrice;
    }
    if (stock !== undefined) {
      const parsedStock = parseInt(stock);
      if (isNaN(parsedStock) || parsedStock < 0) return res.status(400).json({ message: "Stock must be a valid non-negative number" });
      product.stock = parsedStock;
    }
    if (category) product.category = category;

    // handle image updates if new images are uploaded
    if (req.files && req.files.length > 0) {
      if (req.files.length > 3) {
        return res.status(400).json({ message: "Maximum 3 images allowed" });
      }

      const uploadPromises = req.files.map((file) => {
        return cloudinary.uploader.upload(file.path, {
          folder: "products",
        });
      });

      let uploadResults = [];
      try {
        uploadResults = await Promise.all(uploadPromises);
        
        // Delete old unused images before saving new ones
        if (product.images && product.images.length > 0) {
          const deletePromises = product.images.map((imageUrl) => {
            const publicId = "products/" + imageUrl.split("/products/")[1]?.split(".")[0];
            if (publicId) return cloudinary.uploader.destroy(publicId);
          });
          await Promise.all(deletePromises.filter(Boolean));
        }

        product.images = uploadResults.map((result) => result.secure_url);
        
        await product.save();
        res.status(200).json(product);
      } catch (error) {
        if (uploadResults && uploadResults.length > 0) {
          const deletePromises = uploadResults.map((result) =>
            cloudinary.uploader.destroy(result.public_id)
          );
          await Promise.all(deletePromises.filter(Boolean));
        }
        throw error;
      }
    } else {
      await product.save();
      res.status(200).json(product);
    }
  } catch (error) {
    console.error("Error updating products:", error);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (req.files) {
      await Promise.all(
        req.files.map((file) =>
          fs.unlink(file.path).catch((err) => console.error("Failed to delete temp file:", err))
        )
      );
    }
  }
}

export async function getAllOrders(_, res) {
  try {
    const orders = await Order.find()
      .populate("user", "name email")
      .populate("orderItems.product")
      .sort({ createdAt: -1 });

    res.status(200).json({ orders });
  } catch (error) {
    console.error("Error in getAllOrders controller:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateOrderStatus(req, res) {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!["pending", "shipped", "delivered"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.status === status) {
      return res.status(200).json({ message: "Order status unchanged", order });
    }

    const validTransitions = {
      pending: ["shipped"],
      shipped: ["pending", "delivered"],
      delivered: ["shipped"], // Allow reverting mistakes
    };

    if (!validTransitions[order.status]?.includes(status)) {
      return res.status(400).json({ 
        error: `Invalid status transition from ${order.status} to ${status}` 
      });
    }

    order.status = status;

    if (status === "pending") {
      order.shippedAt = undefined;
      order.deliveredAt = undefined;
    } else if (status === "shipped") {
      order.shippedAt = order.shippedAt || new Date();
      order.deliveredAt = undefined;
    } else if (status === "delivered") {
      order.shippedAt = order.shippedAt || new Date();
      order.deliveredAt = order.deliveredAt || new Date();
    }

    await order.save();

    res
      .status(200)
      .json({ message: "Order status updated successfully", order });
  } catch (error) {
    console.error("Error in updateOrderStatus controller:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getAllCustomers(_, res) {
  try {
    //   try sort and get the latest users first

    // const customers = await User.find().sort({ createdAt: -1 }); // latest user first
    const customers = await User.find({ role: "customer" }).sort({ createdAt: -1 });
    res.status(200).json({ customers });
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getDashboardStats(_, res) {
  try {
    const totalOrders = await Order.countDocuments();

    const revenueResult = await Order.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: "$totalPrice" },
        },
      },
    ]);

    const totalRevenue = revenueResult[0]?.total || 0;

    // const totalCustomers = await User.countDocuments();
    const totalCustomers = await User.countDocuments({ role: "customer" });

    const totalProducts = await Product.countDocuments();

    res.status(200).json({
      totalRevenue,
      totalOrders,
      totalCustomers,
      totalProducts,
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Delete images from Cloudinary
    if (product.images && product.images.length > 0) {
      const deletePromises = product.images.map((imageUrl) => {
        // Extract public_id from URL (assumes format: .../products/publicId.ext)
        const publicId =
          "products/" + imageUrl.split("/products/")[1]?.split(".")[0];
        if (publicId) return cloudinary.uploader.destroy(publicId);
      });
      await Promise.all(deletePromises.filter(Boolean));
    }

    await Product.findByIdAndDelete(id);
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ message: "Failed to delete product" });
  }
};
