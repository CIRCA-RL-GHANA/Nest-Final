import { Controller, Get, Post, Put, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CreateReturnRequestDto } from './dto/create-return-request.dto';
import { UpdateReturnStatusDto } from './dto/update-return-status.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { FulfillmentSession } from './entities/fulfillment-session.entity';
import { ReturnRequest } from './entities/return-request.entity';
import { Delivery, DeliveryStatus } from './entities/delivery.entity';
import { DeliveryPackage } from './entities/delivery-package.entity';

/** Roles with order management write access (enterprise operators + admin) */
const ORDER_MANAGE_ROLES = [
  UserRole.ENTERPRISE_ADMIN,
  UserRole.ENTERPRISE_OPERATOR,
  UserRole.ADMIN,
] as const;

/** Roles with order read access */
const ORDER_READ_ROLES = [
  UserRole.ENTERPRISE_ADMIN,
  UserRole.ENTERPRISE_OPERATOR,
  UserRole.ENTERPRISE_VIEWER,
  UserRole.FINANCIAL_INSTITUTION,
  UserRole.FI_AUDITOR,
  UserRole.ADMIN,
  UserRole.USER,
] as const;

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles(UserRole.USER, ...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Create new order' })
  @ApiResponse({ status: 201, description: 'Order created successfully', type: Order })
  async createOrder(
    @CurrentUser('id') buyerId: string,
    @Body() dto: CreateOrderDto,
  ): Promise<Order> {
    return this.ordersService.createOrder(buyerId, dto);
  }

  @Get(':id')
  @Roles(...ORDER_READ_ROLES)
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({ status: 200, description: 'Order found', type: Order })
  async getOrder(@Param('id') id: string): Promise<Order> {
    return this.ordersService.getOrder(id);
  }

  @Get('user/:userId')
  @Roles(...ORDER_READ_ROLES)
  @ApiOperation({ summary: 'Get user orders' })
  @ApiResponse({ status: 200, description: 'Orders retrieved', type: [Order] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getUserOrders(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
  ): Promise<Order[]> {
    return this.ordersService.getUserOrders(userId, limit);
  }

  @Get(':id/items')
  @Roles(...ORDER_READ_ROLES)
  @ApiOperation({ summary: 'Get order items' })
  @ApiResponse({ status: 200, description: 'Order items retrieved', type: [OrderItem] })
  async getOrderItems(@Param('id') id: string): Promise<OrderItem[]> {
    return this.ordersService.getOrderItems(id);
  }

  // ─── Enterprise order management ─────────────────────────────────────────

  /**
   * Get all orders for a branch with optional status filter + pagination.
   * Powers the enterprise Live Operations dashboard.
   */
  @Get('branch/:branchId')
  @Roles(...ORDER_READ_ROLES)
  @ApiOperation({ summary: '[Enterprise] Get all orders for a branch (paginated)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getOrdersByBranch(
    @Param('branchId') branchId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.ordersService.getOrdersByBranch(branchId, { status, limit, offset });
  }

  /**
   * Bulk-update the status of up to 100 orders.
   * Essential for logistics firms processing batch deliveries.
   */
  @Patch('bulk/status')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: '[Enterprise] Bulk-update order status for up to 100 orders' })
  async bulkUpdateStatus(
    @Body() updates: { orderId: string; status: string }[],
  ) {
    return this.ordersService.bulkUpdateOrderStatus(updates);
  }

  // ─── Existing order operations ────────────────────────────────────────────

  @Patch(':id/status')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Partially update order status' })
  @ApiResponse({ status: 200, description: 'Order status updated', type: Order })
  async patchOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<Order> {
    return this.ordersService.updateOrderStatus(id, dto);
  }

  @Put(':id/status')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Update order status' })
  @ApiResponse({ status: 200, description: 'Order status updated', type: Order })
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<Order> {
    return this.ordersService.updateOrderStatus(id, dto);
  }

  @Post(':id/fulfillment/start')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Start order fulfillment' })
  @ApiResponse({ status: 201, description: 'Fulfillment started', type: FulfillmentSession })
  async startFulfillment(
    @Param('id') orderId: string,
    @CurrentUser('id') fulfillerId: string,
  ): Promise<FulfillmentSession> {
    return this.ordersService.startFulfillment(orderId, fulfillerId);
  }

  @Put('fulfillment/:sessionId/complete')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Complete order fulfillment' })
  @ApiResponse({ status: 200, description: 'Fulfillment completed', type: FulfillmentSession })
  async completeFulfillment(@Param('sessionId') sessionId: string): Promise<FulfillmentSession> {
    return this.ordersService.completeFulfillment(sessionId);
  }

  @Post('fulfillment/:sessionId/complete')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Complete order fulfillment (POST)' })
  @ApiResponse({ status: 200, description: 'Fulfillment completed', type: FulfillmentSession })
  async completeFulfillmentPost(@Param('sessionId') sessionId: string): Promise<FulfillmentSession> {
    return this.ordersService.completeFulfillment(sessionId);
  }

  @Post('returns')
  @Roles(UserRole.USER, ...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Create return request' })
  @ApiResponse({ status: 201, description: 'Return request created', type: ReturnRequest })
  async createReturnRequest(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReturnRequestDto,
  ): Promise<ReturnRequest> {
    return this.ordersService.createReturnRequest(userId, dto);
  }

  @Put('returns/:id/status')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Update return request status' })
  @ApiResponse({ status: 200, description: 'Return status updated', type: ReturnRequest })
  async updateReturnStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReturnStatusDto,
  ): Promise<ReturnRequest> {
    return this.ordersService.updateReturnStatus(id, dto);
  }

  @Get('returns/user/:userId')
  @Roles(...ORDER_READ_ROLES)
  @ApiOperation({ summary: 'Get user return requests' })
  @ApiResponse({ status: 200, description: 'Return requests retrieved', type: [ReturnRequest] })
  async getReturnRequests(@Param('userId') userId: string): Promise<ReturnRequest[]> {
    return this.ordersService.getReturnRequests(userId);
  }

  @Post(':id/delivery')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Create delivery for order' })
  @ApiResponse({ status: 201, description: 'Delivery created', type: Delivery })
  async createDelivery(
    @Param('id') orderId: string,
    @CurrentUser('id') driverId: string,
  ): Promise<Delivery> {
    return this.ordersService.createDelivery(orderId, driverId);
  }

  @Put('deliveries/:id/status')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Update delivery status' })
  @ApiResponse({ status: 200, description: 'Delivery status updated', type: Delivery })
  async updateDeliveryStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
  ): Promise<Delivery> {
    return this.ordersService.updateDeliveryStatus(id, dto);
  }

  @Get('deliveries/driver/:driverId')
  @Roles(...ORDER_READ_ROLES)
  @ApiOperation({ summary: 'Get driver deliveries' })
  @ApiResponse({ status: 200, description: 'Deliveries retrieved', type: [Delivery] })
  @ApiQuery({ name: 'status', required: false, enum: DeliveryStatus })
  async getDriverDeliveries(
    @Param('driverId') driverId: string,
    @Query('status') status?: DeliveryStatus,
  ): Promise<Delivery[]> {
    return this.ordersService.getDriverDeliveries(driverId, status);
  }

  @Post('packages')
  @Roles(...ORDER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Create delivery package for multiple orders' })
  @ApiResponse({ status: 201, description: 'Package created', type: DeliveryPackage })
  async createDeliveryPackage(
    @CurrentUser('id') driverId: string,
    @Body('orderIds') orderIds: string[],
  ): Promise<DeliveryPackage> {
    return this.ordersService.createDeliveryPackage(driverId, orderIds);
  }

  @Get('packages/driver/:driverId')
  @Roles(...ORDER_READ_ROLES)
  @ApiOperation({ summary: 'Get driver packages' })
  @ApiResponse({ status: 200, description: 'Packages retrieved', type: [DeliveryPackage] })
  async getDriverPackages(@Param('driverId') driverId: string): Promise<DeliveryPackage[]> {
    return this.ordersService.getDriverPackages(driverId);
  }
}

