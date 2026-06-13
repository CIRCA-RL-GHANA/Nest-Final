import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tab } from './tab.entity';
import { TabsService } from './tabs.service';
import { TabsController } from './tabs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tab])],
  controllers: [TabsController],
  providers: [TabsService],
  exports: [TabsService],
})
export class TabsModule {}
