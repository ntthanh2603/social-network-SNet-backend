import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeviceSession } from './entities/device-session.entity';
import { Repository } from 'typeorm';
import { IUser } from 'src/users/users.interface';
import { LoginMetaData } from 'src/users/users.controller';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import addDay from 'src/helper/addDay';
import { randomUUID } from 'crypto';
import * as randomatic from 'randomatic';

export interface ISession {
  userId: string;
  deviceId: string;
  ipAddress: string;
  lastActive: Date;
  refreshToken: string;
  expiredAt: number;
  createdAt: Date;
}

@Injectable()
export class DeviceSessionsService {
  constructor(
    @InjectRepository(DeviceSession)
    private repository: Repository<DeviceSession>,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {}

  async logout(user: IUser, deviceId: string) {
    const result = await this.repository.delete({ userId: user.id, deviceId });
    if (result['affected'] != 0) return { message: 'Đăng xuất thành công' };
    else throw new InternalServerErrorException('Lỗi khi đăng xuất tài khoản');
  }

  async updateToken(userId: string, refreshToken: string) {
    return await this.repository.update({ userId }, { refreshToken });
  }

  async findOneByUserIdAndDevice(userId: string, deviceId: string) {
    return await this.repository.findOne({ where: { userId, deviceId } });
  }

  generateAccessToken(userId: string, deviceId: string) {
    const payload = {
      id: userId,
      sub: deviceId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_TOKEN_SECRET'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRE'),
    });

    return accessToken;
  }

  handleVerifyToken(token: string) {
    try {
      return this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_TOKEN_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Token invalid');
    }
  }

  async reAuth(_refreshToken: string, deviceId: string) {
    const session = await this.repository.findOne({
      where: { deviceId, refreshToken: _refreshToken },
    });

    if (
      !session ||
      new Date(session.expiredAt).valueOf() < new Date().valueOf()
    ) {
      throw new UnauthorizedException('Refresh token invalid');
    }

    const secretKey = randomatic('A0', 16);

    const [accessToken, refreshToken, expiredAt] = [
      this.generateAccessToken(session.userId, deviceId),
      randomatic('Aa0', 64),
      addDay(this.configService.get<number>('JWT_REFRESH_EXPIRE_DAY')),
    ];

    await this.repository.update(session.id, {
      refreshToken,
      expiredAt,
      secretKey,
    });
    return { accessToken, refreshToken, expiredAt };
  }

  async handleLogin(userId: string, metaData: LoginMetaData) {
    const { deviceId, ipAddress } = metaData;

    const currentDevice = await this.repository.findOne({
      where: { deviceId },
    });

    const secretKey = randomatic('A0', 16);

    const [accessToken, refreshToken, expiredAt] = [
      this.generateAccessToken(userId, deviceId),
      randomatic('Aa0', 64),
      addDay(this.configService.get<number>('JWT_REFRESH_EXPIRE_DAY')),
    ];

    const newDeviceSession = new DeviceSession();
    newDeviceSession.userId = userId;
    newDeviceSession.deviceId = deviceId;
    newDeviceSession.ipAddress = ipAddress;
    newDeviceSession.refreshToken = refreshToken;
    newDeviceSession.secretKey = secretKey;
    newDeviceSession.expiredAt = expiredAt;
    newDeviceSession.createdAt = new Date();

    // update or create device session
    await this.repository.save({
      id: currentDevice?.id || randomUUID(),
      ...newDeviceSession,
    });
    return { accessToken, refreshToken, expiredAt };
  }
}
