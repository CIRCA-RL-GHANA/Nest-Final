import { Controller, Get, Post, Put, Patch, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StatementService } from './statement.service';
import { CreateStatementDto, UpdateStatementDto } from './dto';
import { Statement } from './entities/statement.entity';

@ApiTags('Statement')
@Controller('statement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class StatementController {
  constructor(private readonly statementService: StatementService) {}

  @Post()
  @ApiOperation({ summary: 'Create or update personal statement' })
  @ApiResponse({
    status: 201,
    description: 'Statement created/updated successfully',
    type: Statement,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async createOrUpdateStatement(
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateStatementDto,
  ): Promise<Statement> {
    return this.statementService.createOrUpdateStatement(userId, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get personal statement' })
  @ApiResponse({ status: 200, description: 'Statement retrieved successfully', type: Statement })
  @ApiResponse({ status: 404, description: 'Statement not found' })
  async getStatement(@CurrentUser('id') userId: string): Promise<Statement> {
    return this.statementService.getStatement(userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Partially update personal statement' })
  @ApiResponse({ status: 200, description: 'Statement updated successfully', type: Statement })
  @ApiResponse({ status: 404, description: 'Statement not found' })
  async patchStatement(
    @CurrentUser('id') userId: string,
    @Body() updateDto: UpdateStatementDto,
  ): Promise<Statement> {
    return this.statementService.updateStatement(userId, updateDto);
  }

  @Put()
  @ApiOperation({ summary: 'Update personal statement' })
  @ApiResponse({ status: 200, description: 'Statement updated successfully', type: Statement })
  @ApiResponse({ status: 404, description: 'Statement not found' })
  async updateStatement(
    @CurrentUser('id') userId: string,
    @Body() updateDto: UpdateStatementDto,
  ): Promise<Statement> {
    return this.statementService.updateStatement(userId, updateDto);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete personal statement' })
  @ApiResponse({ status: 200, description: 'Statement deleted successfully' })
  @ApiResponse({ status: 404, description: 'Statement not found' })
  async deleteStatement(@CurrentUser('id') userId: string): Promise<{ message: string }> {
    await this.statementService.deleteStatement(userId);
    return { message: 'Statement deleted successfully' };
  }

  @Get('exists')
  @ApiOperation({ summary: 'Check if user has a statement' })
  @ApiResponse({ status: 200, description: 'Check completed' })
  async hasStatement(@CurrentUser('id') userId: string): Promise<{ exists: boolean }> {
    const exists = await this.statementService.hasStatement(userId);
    return { exists };
  }
}
