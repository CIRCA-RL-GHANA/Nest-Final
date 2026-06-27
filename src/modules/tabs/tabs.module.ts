import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tab } from './entities/tab.entity';
import { TabTransaction } from './entities/tab-transaction.entity';
import { TabsService } from './tabs.service';
import { TabsController } from './tabs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tab, TabTransaction])],
  controllers: [TabsController],
  providers: [TabsService],
  exports: [TabsService],
})
export class TabsModule {}
