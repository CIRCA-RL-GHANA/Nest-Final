import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailService } from './services/email.service';
import { NotificationService } from './services/notification.service';
import { InAppNotificationEntity } from './entities/in-app-notification.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([InAppNotificationEntity])],
  providers: [EmailService, NotificationService],
  exports: [EmailService, NotificationService],
})
export class CommonModule {}
