import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { FulfillmentSession, FulfillmentStatus } from './entities/fulfillment-session.entity';
import { ReturnRequest, ReturnStatus } from './entities/return-request.entity';
import { Delivery, DeliveryStatus } from './entities/delivery.entity';
import { DeliveryPackage } from './entities/delivery-package.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CreateReturnRequestDto } from './dto/create-return-request.dto';
import { UpdateReturnStatusDto } from './dto/update-return-status.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { ProductsService } from '../products/products.service';
import { QPointsTransactionService } from '../qpoints/qpoints-transaction.service';
import { QPointAccount } from '../qpoints/entities/qpoint-account.entity';
import { AIFraudService } from '../ai/services/ai-fraud.service';
import { AINlpService } from '../ai/services/ai-nlp.service';
import { AISearchService } from '../ai/services/ai-search.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(FulfillmentSession)
    private readonly fulfillmentRepository: Repository<FulfillmentSession>,
    @InjectRepository(ReturnRequest)
    private readonly returnRepository: Repository<ReturnRequest>,
    @InjectRepository(Delivery)
    private readonly deliveryRepository: Repository<Delivery>,
    @InjectRepository(DeliveryPackage)
    private readonly packageRepository: Repository<DeliveryPackage>,
    private readonly productsService: ProductsService,
    @InjectRepository(QPointAccount)
    private readonly qpointAccountRepository: Repository<QPointAccount>,
    private readonly qpointsService: QPointsTransactionService,
    private readonly aiFraud: AIFraudService,
    private readonly aiNlp: AINlpService,
    private readonly aiSearch: AISearchService,
    private readonly dataSource: DataSource,
  ) {}

  async createOrder(buyerId: string, dto: CreateOrderDto): Promise<Order> {
    // ISSUE-32: CSPRNG for order number
    const orderNumber = `ORD-${new Date().getFullYear()}-${String(crypto.randomInt(0, 99999)).padStart(5, '0')}`;

    // Fetch product details and calculate real totals
    const itemsWithProducts = await Promise.all(
      dto.items.map(async (item) => {
        const product = await this.productsService.getProductById(item.productId);
        const unitPrice = Number(product.discountedPrice ?? product.price);
        return { item, product, unitPrice, totalPrice: unitPrice * item.quantity };
      }),
    );

    const subtotal = itemsWithProducts.reduce((sum, i) => sum + i.totalPrice, 0);
    const deliveryFee = 5;
    const tax = parseFloat((subtotal * 0.075).toFixed(2));
    const discount = 0;
    const total = parseFloat((subtotal + deliveryFee + tax - discount).toFixed(2));

    // ISSUE-27: use async scorer (includes TF model)
    const fraudResult = await this.aiFraud.scoreTransactionAsync({
      userId: buyerId,
      amount: total,
      currency: 'NGN',
      paymentMethod: dto.paymentMethod ?? 'unknown',
    });

    if (fraudResult.blocked) {
      this.logger.warn(
        `[AI-FRAUD] Order blocked for buyer ${buyerId}: score=${fraudResult.riskScore}`,
      );
      throw new BadRequestException('Order declined due to suspicious activity. Contact support.');
    }

    if (fraudResult.reviewFlag) {
      this.logger.warn(
        `[AI-FRAUD] Order flagged for review — buyer=${buyerId} score=${fraudResult.riskScore}`,
      );
    }

    // ── AI: Index delivery notes for searchability ─────────────────────────────
    if (dto.deliveryNotes) {
      const noteKeywords = this.aiNlp.extractKeywords(dto.deliveryNotes, 5);
      this.logger.log(`[AI-NLP] Order delivery notes keywords: ${noteKeywords.join(', ')}`);
    }

    // ISSUE-Z: wrap order + items in a single transaction so items are never
    // persisted without their parent order, and a partial item-save failure rolls
    // back the entire order.
    return this.dataSource.transaction(async (manager) => {
      const order = manager.getRepository(Order).create({
        orderNumber,
        buyerId,
        branchId: dto.branchId,
        status: OrderStatus.PENDING,
        subtotal,
        deliveryFee,
        tax,
        discount,
        total,
        paymentMethod: dto.paymentMethod,
        isPaid: false,
        deliveryAddress: dto.deliveryAddress,
        deliveryNotes: dto.deliveryNotes || null,
        metadata: {
          ai: {
            fraudScore: fraudResult.riskScore,
            fraudRiskLevel: fraudResult.riskLevel,
            reviewFlagged: fraudResult.reviewFlag,
          },
        },
      });

      const savedOrder = await manager.getRepository(Order).save(order);

      for (const { item, product, unitPrice, totalPrice } of itemsWithProducts) {
        const orderItem = manager.getRepository(OrderItem).create({
          orderId: savedOrder.id,
          productId: item.productId,
          productName: product.name,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
          notes: item.notes || null,
        });
        await manager.getRepository(OrderItem).save(orderItem);
      }

      return savedOrder;
    });
  }

  // ISSUE-Y: valid forward-only status transitions for an order.
  private static readonly VALID_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
    [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
    [OrderStatus.PROCESSING]: [OrderStatus.READY_FOR_PICKUP, OrderStatus.CANCELLED],
    [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED],
    [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
  };

  async updateOrderStatus(orderId: string, dto: UpdateOrderStatusDto): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const allowedNext = OrdersService.VALID_TRANSITIONS[order.status];
    if (!allowedNext || !allowedNext.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition order from "${order.status}" to "${dto.status}". ` +
        `Allowed transitions: ${allowedNext?.join(', ') ?? 'none (terminal status)'}`,
      );
    }

    order.status = dto.status;
    if (dto.fulfillerId) order.fulfillerId = dto.fulfillerId;
    if (dto.driverId) order.driverId = dto.driverId;

    if (dto.status === OrderStatus.DELIVERED) {
      order.deliveredAt = new Date();
    }

    return this.orderRepository.save(order);
  }

  async getOrder(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async getUserOrders(userId: string, limit = 20): Promise<Order[]> {
    return this.orderRepository.find({
      where: { buyerId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getOrderItems(orderId: string): Promise<OrderItem[]> {
    return this.orderItemRepository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
  }

  async startFulfillment(orderId: string, fulfillerId: string): Promise<FulfillmentSession> {
    const order = await this.getOrder(orderId);

    if (order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException('Order must be confirmed before fulfillment');
    }

    const session = this.fulfillmentRepository.create({
      fulfillerId,
      orderId,
      status: FulfillmentStatus.IN_PROGRESS,
      startedAt: new Date(),
    });

    await this.orderRepository.update(orderId, {
      status: OrderStatus.PROCESSING,
      fulfillerId,
    });

    return this.fulfillmentRepository.save(session);
  }

  async completeFulfillment(sessionId: string): Promise<FulfillmentSession> {
    const session = await this.fulfillmentRepository.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Fulfillment session not found');
    }

    session.status = FulfillmentStatus.COMPLETED;
    session.completedAt = new Date();

    await this.orderRepository.update(session.orderId, {
      status: OrderStatus.READY_FOR_PICKUP,
    });

    return this.fulfillmentRepository.save(session);
  }

  async createReturnRequest(userId: string, dto: CreateReturnRequestDto): Promise<ReturnRequest> {
    const order = await this.getOrder(dto.orderId);

    if (order.buyerId !== userId) {
      throw new BadRequestException('Unauthorized to request return for this order');
    }

    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Only delivered orders can be returned');
    }

    const returnRequest = this.returnRepository.create({
      orderId: dto.orderId,
      requestedBy: userId,
      reason: dto.reason,
      status: ReturnStatus.REQUESTED,
      description: dto.description,
      itemIds: dto.itemIds,
    });

    return this.returnRepository.save(returnRequest);
  }

  async updateReturnStatus(returnId: string, dto: UpdateReturnStatusDto): Promise<ReturnRequest> {
    const returnRequest = await this.returnRepository.findOne({ where: { id: returnId } });
    if (!returnRequest) {
      throw new NotFoundException('Return request not found');
    }

    returnRequest.status = dto.status;

    if (dto.status === ReturnStatus.APPROVED) {
      returnRequest.approvedAt = new Date();
      returnRequest.refundAmount = dto.refundAmount || null;
    }

    if (dto.status === ReturnStatus.REJECTED) {
      returnRequest.rejectionReason = dto.rejectionReason || null;
    }

    if (dto.status === ReturnStatus.REFUNDED && returnRequest.refundAmount) {
      // Credit refund amount as QPoints to the buyer's account
      const buyerOrder = await this.orderRepository.findOne({
        where: { id: returnRequest.orderId },
      });
      if (buyerOrder) {
        const buyerAccount = await this.qpointAccountRepository.findOne({
          where: { entityId: buyerOrder.buyerId },
        });
        if (buyerAccount) {
          await this.qpointsService.deposit(
            {
              accountId: buyerAccount.id,
              amount: Number(returnRequest.refundAmount),
              paymentReference: `REFUND_${returnRequest.id}`,
              metadata: { orderId: returnRequest.orderId, returnId: returnRequest.id },
            },
            buyerOrder.buyerId,
          );
        }
      }
      await this.orderRepository.update(returnRequest.orderId, {
        status: OrderStatus.REFUNDED,
      });
    }

    return this.returnRepository.save(returnRequest);
  }

  async getReturnRequests(userId: string): Promise<ReturnRequest[]> {
    return this.returnRepository.find({
      where: { requestedBy: userId },
      order: { createdAt: 'DESC' },
    });
  }

  async createDelivery(orderId: string, driverId: string): Promise<Delivery> {
    const order = await this.getOrder(orderId);

    if (order.status !== OrderStatus.READY_FOR_PICKUP) {
      throw new BadRequestException('Order must be ready for pickup');
    }

    const delivery = this.deliveryRepository.create({
      orderId,
      driverId,
      status: DeliveryStatus.ASSIGNED,
      pickupLocation: { lat: 0, lng: 0, address: 'Branch Address' },
      deliveryLocation: {
        lat: order.deliveryAddress.coordinates?.lat || 0,
        lng: order.deliveryAddress.coordinates?.lng || 0,
        address: `${order.deliveryAddress.street}, ${order.deliveryAddress.city}`,
      },
    });

    await this.orderRepository.update(orderId, {
      status: OrderStatus.OUT_FOR_DELIVERY,
      driverId,
    });

    return this.deliveryRepository.save(delivery);
  }

  async updateDeliveryStatus(deliveryId: string, dto: UpdateDeliveryStatusDto): Promise<Delivery> {
    const delivery = await this.deliveryRepository.findOne({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    delivery.status = dto.status;

    if (dto.status === DeliveryStatus.PICKED_UP) {
      delivery.pickedUpAt = new Date();
    }

    if (dto.status === DeliveryStatus.DELIVERED) {
      delivery.deliveredAt = new Date();
      delivery.proofOfDelivery = dto.proofOfDelivery || null;
      delivery.recipientName = dto.recipientName || null;
      delivery.rating = dto.rating || null;

      await this.orderRepository.update(delivery.orderId, {
        status: OrderStatus.DELIVERED,
        deliveredAt: new Date(),
      });
    }

    if (dto.notes) {
      delivery.notes = dto.notes;
    }

    return this.deliveryRepository.save(delivery);
  }

  async getDriverDeliveries(driverId: string, status?: DeliveryStatus): Promise<Delivery[]> {
    const where: any = { driverId };
    if (status) where.status = status;

    return this.deliveryRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async createDeliveryPackage(driverId: string, orderIds: string[]): Promise<DeliveryPackage> {
    // ISSUE-32: CSPRNG for package number
    const packageNumber = `PKG-${new Date().getFullYear()}-${String(crypto.randomInt(0, 99999)).padStart(5, '0')}`;

    const pkg = this.packageRepository.create({
      packageNumber,
      driverId,
      totalOrders: orderIds.length,
    });

    return this.packageRepository.save(pkg);
  }

  async getDriverPackages(driverId: string): Promise<DeliveryPackage[]> {
    return this.packageRepository.find({
      where: { driverId },
      order: { createdAt: 'DESC' },
    });
  }

  async getOrderDelivery(orderId: string): Promise<Delivery | null> {
    return this.deliveryRepository.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  async rateOrder(orderId: string, rating: number, review: string | undefined, userId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    order.rating = rating;
    order.review = review ?? null;
    return this.orderRepository.save(order);
  }

  // ─── Enterprise order management ─────────────────────────────────────────

  /**
   * Get all orders for a branch (scoped to branchId).
   * Used by the enterprise Live Operations dashboard.
   * Supports optional status filter and cursor-based pagination.
   */
  async getOrdersByBranch(
    branchId: string,
    filters?: { status?: string; limit?: number; offset?: number },
  ): Promise<{ orders: Order[]; total: number }> {
    const qb = this.orderRepository
      .createQueryBuilder('o')
      .where('o.branchId = :branchId', { branchId });

    if (filters?.status) {
      qb.andWhere('o.status = :status', { status: filters.status });
    }

    const total = await qb.getCount();
    const orders = await qb
      .orderBy('o.createdAt', 'DESC')
      .limit(filters?.limit ?? 50)
      .offset(filters?.offset ?? 0)
      .getMany();

    return { orders, total };
  }

  /**
   * Bulk-update the status of up to 100 orders at once.
   * Essential for large logistics firms processing batch deliveries.
   * Returns the count of updated rows.
   */
  async bulkUpdateOrderStatus(
    updates: { orderId: string; status: string }[],
  ): Promise<{ updated: number }> {
    if (!updates?.length) return { updated: 0 };
    if (updates.length > 100) {
      // ISSUE-28: throw proper HTTP exception, not bare Error
      throw new BadRequestException('Bulk order status update is limited to 100 orders per request');
    }
    // ISSUE-28: validate each status against the enum before writing
    const validStatuses = Object.values(OrderStatus) as string[];
    for (const u of updates) {
      if (!validStatuses.includes(u.status)) {
        throw new BadRequestException(
          `Invalid order status "${u.status}". Valid values: ${validStatuses.join(', ')}`,
        );
      }
    }
    // ISSUE-N: wrap all updates in a single transaction so a mid-batch failure
    // doesn't leave the order table in a partially updated state.
    let count = 0;
    await this.dataSource.transaction(async (manager) => {
      for (const u of updates) {
        await manager.getRepository(Order).update(u.orderId, { status: u.status as OrderStatus });
        count++;
      }
    });
    return { updated: count };
  }
}
